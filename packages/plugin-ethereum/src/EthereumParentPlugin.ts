import { ParentIFrameProvider } from "./ParentIFrameProvider";
import { Action, MiddlewareAPI, Dispatch } from "redux";
import { ParentPlugin, DMZ, RECEIVED_CHILD_MESSAGE } from "@kirby-web3/parent-core";

// web3.js hates typescript *eyeroll*
import WebWsProvider = require("web3-providers-ws");
import Web3HttpProvider = require("web3-providers-http");
import Web3 = require("web3");

// EthereumPlugin action types
export const ETHEREUM_NEW_WEB3_INSTANCE = "ETHEREUM_NEW_WEB3_INSTANCE";
export const ETHEREUM_ACCOUNT_CHANGE = "ETHEREUM_ACCOUNT_CHANGE";

export interface EthereumPluginState {
  readonly: boolean;
  account?: string;
}

export interface NewWeb3Instance {
  type: typeof ETHEREUM_NEW_WEB3_INSTANCE;
  payload: {
    providerType: string;
  };
}

export interface AccountChange {
  type: typeof ETHEREUM_ACCOUNT_CHANGE;
  payload: {
    accounts: string[];
  };
}

export type EthereumPluginActions = NewWeb3Instance | AccountChange;

export interface Config {
  readOnlyNodeURI: string;
}

export interface Dependencies {
  dmz: DMZ;
}

export class EthereumParentPlugin extends ParentPlugin<Config, Dependencies, EthereumPluginActions> {
  public name = "ethereum";
  public dependsOn = ["dmz"];
  public web3: any;

  public middleware = (api: MiddlewareAPI<any>) => (next: Dispatch<any>) => <A extends Action>(action: any): void => {
    if (action.type === RECEIVED_CHILD_MESSAGE && action.payload.data.requestType === "WEB3_ENABLE") {
      this.dispatch({ type: ETHEREUM_NEW_WEB3_INSTANCE, payload: { providerType: action.payload.providerType } });
    }
    next(action);
  };

  public reducer(state: EthereumPluginState = { readonly: true }, action: Action): any {
    if (action.type === ETHEREUM_NEW_WEB3_INSTANCE) {
      return { ...state, readonly: false };
    } else if (action.type === ETHEREUM_ACCOUNT_CHANGE) {
      const tAction = action as AccountChange;
      return { ...state, account: tAction.payload.accounts[0] };
    }
    return state;
  }

  public async startup(): Promise<void> {
    let readOnlyProvider;
    if (this.config.readOnlyNodeURI.startsWith("ws")) {
      readOnlyProvider = new WebWsProvider(this.config.readOnlyNodeURI);
      // this.readonly = true;
    } else if (this.config.readOnlyNodeURI.startsWith("http")) {
      readOnlyProvider = new Web3HttpProvider(this.config.readOnlyNodeURI);
      // this.readonly = true;
    } else {
      throw new Error("could not initialize provider");
    }
    this.web3 = new Web3(readOnlyProvider);
  }

  public async requestSignerWeb3(): Promise<void> {
    const provider = new ParentIFrameProvider(this.dependencies.dmz);
    await provider.enable();
    this.web3 = new Web3(provider);
    await this.getAccounts();
  }

  public async getAccounts(): Promise<string[]> {
    const accounts = await this.web3.eth.getAccounts();

    this.dispatch({ type: ETHEREUM_ACCOUNT_CHANGE, payload: { accounts } });
    return accounts;
  }
}