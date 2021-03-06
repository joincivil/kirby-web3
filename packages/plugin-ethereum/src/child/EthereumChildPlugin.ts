import { MiddlewareAPI, Action, Dispatch } from "redux";
import HDWalletProvider = require("@truffle/hdwallet-provider");
import { ethers } from "ethers";

import Web3 = require("web3");
import WebWsProvider = require("web3-providers-ws");
import Web3HttpProvider = require("web3-providers-http");

import { ChildPlugin, ParentHandler, PARENT_REQUEST, PARENT_RESPONSE, ViewPlugin } from "@kirby-web3/child-core";
import { SEND_TO_PARENT } from "@kirby-web3/common";

import { ChildIFrameProvider } from "./ChildIFrameProvider";
import { ETHEREUM_WEB3_CHANGE_ACCOUNT, ETHEREUM_WEB3_CHANGE_NETWORK, ProviderTypes, Network } from "../common";

export interface EthereumChildPluginState {
  providerType?: string;
  network?: Network;
  networkID?: number;
  accounts?: string[];
}

export interface EthereumChildPluginConfig {
  defaultNetwork: Network;
  networks: {
    [key in Network]?: string;
  };
  burnerPreference: string;
  portis?: {
    appID: string;
  };
}

export class EthereumChildPlugin extends ChildPlugin<EthereumChildPluginConfig> {
  public name = "ethereum";
  public provider!: ChildIFrameProvider;
  public web3: typeof Web3;
  public dependsOn = ["iframe", "view"];

  public async startup(): Promise<void> {
    this.provider = new ChildIFrameProvider(event => {
      this.dispatch({ type: SEND_TO_PARENT, payload: event });
    });

    const rpcUrl = this.config.networks[this.config.defaultNetwork];
    if (!rpcUrl) {
      throw new Error(
        "could not start EthereumChildPlugin since there is no RPC URL defined for the default network (this.config.networks[this.config.defaultNetwork])",
      );
    }

    await this.provider.initialize(rpcUrl);
    this.web3 = new Web3(this.provider);
    if (window) {
      const win = window as any;
      if (win.ethereum) {
        win.ethereum.autoRefreshOnNetworkChange = false;
      }
    }
  }

  public middleware = (api: MiddlewareAPI<any>) => (next: Dispatch<any>) => <A extends Action>(action: any): void => {
    const iframePlugin = this.dependencies.iframe as ParentHandler;
    const viewPlugin = this.dependencies.view as ViewPlugin;
    if (action.type === PARENT_REQUEST && action.data.type === "WEB3_REQUEST") {
      this.provider
        .handleIFrameMessage(action.data.data)
        .then(response => {
          this.logger("got a response", response);
          this.dispatch({ type: PARENT_RESPONSE, requestID: action.requestID, payload: response });
        })
        .catch(err => {
          this.logger("middleware error: ", err);
          iframePlugin.reject(action.requestID, err);
        });
    } else if (action.type === PARENT_REQUEST && action.data.type === "WEB3_ENABLE") {
      const providerType =
        iframePlugin.getSitePreference("WEB3_PROVIDER_TYPE") ||
        (this.config.burnerPreference === "always" && ProviderTypes.BURNER);

      viewPlugin.requestView("/ethereum/web3enable", {
        network: this.config.defaultNetwork,
        providerPreference: providerType,
        requestID: action.requestID,
      });
      return;
    } else if (action.type === "PARENT_REQUEST" && action.data.type === ETHEREUM_WEB3_CHANGE_ACCOUNT) {
      viewPlugin.requestView("/ethereum/web3enable", {
        network: api.getState().ethereum.network,
        requestID: action.requestID,
      });
      return;
    } else if (action.type === "PARENT_REQUEST" && action.data.type === ETHEREUM_WEB3_CHANGE_NETWORK) {
      this.changeNetwork(action.requestID, action.data.payload, api.getState().ethereum).catch(err => {
        console.error("unable to change network: ", err);
      });
      return;
    }
    next(action);
  };

  public reducer(state: EthereumChildPluginState = {}, action: any): any {
    if (action.type === PARENT_RESPONSE && action.payload && action.payload.requestType === "WEB3_ENABLE") {
      return { ...state, ...action.payload };
    } else if (action.type === SEND_TO_PARENT && action.payload.type === "WEB3_ON_NETWORKCHANGED") {
      return { ...state, networkID: action.payload.payload };
    } else if (action.type === SEND_TO_PARENT && action.payload.type === "WEB3_ON_ACCOUNTSCHANGED") {
      return { ...state, accounts: action.payload.payload };
    }
    return state;
  }

  public async enableWeb3(requestID: number, providerType: string, network: Network): Promise<void> {
    await this.changeProvider(providerType, network);

    this.dispatch({
      type: PARENT_RESPONSE,
      requestID,
      payload: { providerType, network, requestType: "WEB3_ENABLE" },
    });
  }

  public async changeProvider(providerType: string, network: Network): Promise<any> {
    let concreteProvider;
    if (providerType === ProviderTypes.METAMASK) {
      const win = window as any;
      if (win.ethereum) {
        concreteProvider = win.ethereum;
      } else {
        throw new Error("no injected web3 provided");
      }
    } else if (providerType === ProviderTypes.PORTIS) {
      const Portis = await import("@portis/web3");
      const portis = new Portis(this.config.portis!.appID, network);
      // const portis = new Portis(this.config.portis!.appID, {
      //   nodeUrl: this.getRPCUrl(network),
      //   chainId: NetworkID[network],
      // });
      concreteProvider = portis.provider;
      this.setupPortisEffects(portis);
    } else if (providerType === ProviderTypes.BURNER) {
      const burnerProvider = this.getBurnerProvider(network);
      concreteProvider = burnerProvider;
    } else if (providerType === ProviderTypes.READONLY) {
      const readOnlyRPCUrl = this.getRPCUrl(network);
      if (readOnlyRPCUrl.startsWith("ws")) {
        concreteProvider = new WebWsProvider(readOnlyRPCUrl);
      } else {
        concreteProvider = new Web3HttpProvider(readOnlyRPCUrl);
      }
    } else {
      throw new Error("unrecognized provider: " + providerType);
    }

    await this.setConcreteProvider(concreteProvider, providerType);

    return concreteProvider;
  }

  public async changeNetwork(requestID: number, network: Network, state: any): Promise<void> {
    if (state.network !== network) {
      await this.enableWeb3(requestID, state.providerType, network);
    } else {
      this.logger("do not need to change network");
      this.dispatch({ type: PARENT_RESPONSE, requestID, payload: network });
    }
  }

  public async setPrivateKeyProvider(pk: string, network: Network, providerType: ProviderTypes): Promise<any> {
    let readOnlyProvider;
    const readOnlyRPCUrl = this.getRPCUrl(network);
    if (readOnlyRPCUrl.startsWith("ws")) {
      readOnlyProvider = new WebWsProvider(readOnlyRPCUrl);
    } else {
      readOnlyProvider = new Web3HttpProvider(readOnlyRPCUrl);
    }

    const concreteProvider = new HDWalletProvider(pk, readOnlyProvider);
    await this.setConcreteProvider(concreteProvider, providerType);
    return "ok";
  }

  public getBurnerProvider(network: Network): any {
    const parentHandler = this.dependencies.iframe as ParentHandler;
    const burnerMnemonic = parentHandler.getSitePreference("burner_mnemonic");
    let pk;
    if (!burnerMnemonic) {
      const wallet = ethers.Wallet.createRandom();
      const mnemonic = wallet.mnemonic;
      pk = wallet.privateKey;
      parentHandler.setSitePreference("burner_mnemonic", mnemonic);
    } else {
      const wallet = ethers.Wallet.fromMnemonic(burnerMnemonic);
      pk = wallet.privateKey;
    }

    const rpcUrl = this.getRPCUrl(network);
    return new HDWalletProvider(pk, rpcUrl);
  }

  public getRPCUrl(network: Network): string {
    const rpcUrl = this.config.networks[network];
    if (!rpcUrl) {
      throw new Error("could not build RPC URL since it is not defined for the network " + network);
    }

    return rpcUrl;
  }

  public setupPortisEffects(portis: any): void {
    this.logger("setting up portis effects");
    portis.onLogout(async () => {
      console.log("logged out of portis");
    });
  }

  public cancelEnableWeb3(requestID: number): void {
    const iframePlugin = this.dependencies.iframe as ParentHandler;
    iframePlugin.reject(requestID, "cancelled");
  }

  private async setConcreteProvider(concreteProvider: any, providerType: ProviderTypes): Promise<void> {
    await this.provider.setConcreteProvider(concreteProvider);
    const accounts = await this.web3.eth.getAccounts();
    const networkID: number = await this.web3.eth.net.getId();
    if (this.getState().ethereum.networkID !== networkID) {
      this.dispatch({ type: SEND_TO_PARENT, payload: { type: "WEB3_ON_NETWORKCHANGED", payload: networkID } });
    }
    if (!this.getState().ethereum.accounts || this.getState().ethereum.accounts.join() !== accounts.join()) {
      this.dispatch({ type: SEND_TO_PARENT, payload: { type: "WEB3_ON_ACCOUNTSCHANGED", payload: accounts } });
    }

    // set the providerType preference if necessary
    const iframePlugin = this.dependencies.iframe;
    const savedProviderType = iframePlugin.getSitePreference("WEB3_PROVIDER_TYPE");
    if (savedProviderType !== providerType) {
      iframePlugin.setSitePreference("WEB3_PROVIDER_TYPE", providerType);
    }
  }
}
