import debug from "debug";
import { DMZ } from "@kirby-web3/parent-core";

export class ParentIFrameProvider {
  private dmz: DMZ;
  private logger = debug("kirby:parent:ParentIFrameProvider");

  constructor(dmz: DMZ) {
    this.dmz = dmz;
  }

  public supportsSubscriptions(): boolean {
    // return this.base.supportsSubscriptions();
    return false;
  }

  public registerEventListeners(): void {
    // return this.base.registerEventListeners();
    this.logger("calling registerEventListeners");
    return;
  }

  public async enable(): Promise<void> {
    const response = await this.dmz.waitForChildInteraction({ type: "WEB3_ENABLE", data: {} });
    this.logger("iframeMessage response", response);
  }

  public async send(data: any, cb: any): Promise<any> {
    return this.iframeMessage("send", cb, data);
  }

  public async sendBatch(methods: any[], moduleInstance: any): Promise<any[]> {
    return this.iframeMessage("sendBatch", undefined, { methods, moduleInstance });
  }

  public async subscribe(subscribeMethod: string, subscriptionMethod: string, parameters: any[]): Promise<string> {
    return this.iframeMessage("subscribe", undefined, subscribeMethod, subscriptionMethod, parameters);
  }

  public async unsubscribe(subscriptionId: string, unsubscribeMethod: string): Promise<boolean> {
    return this.iframeMessage("unsubscribe", undefined, subscriptionId, unsubscribeMethod);
  }

  public async clearSubscriptions(unsubscribeMethod: string): Promise<boolean> {
    return this.iframeMessage("clearSubscriptions", undefined, unsubscribeMethod);
  }

  public on(type: string, callback: () => void): void {
    this.dmz.listen("WEB3_ON_" + type.toUpperCase(), callback);
  }

  public removeListener(type: string, callback: () => void): void {
    // return this.base.removeListener(type, callback);
  }

  public removeAllListeners(type: string): void {
    // return this.base.removeAllListeners(type);
  }

  public reset(): void {
    // this.iframeMessage("reset", undefined, {});
  }

  public reconnect(): void {
    // this.iframeMessage("reconnect", undefined, {});
  }

  public disconnect(code: number, reason: string): void {
    // this.iframeMessage("disconnect", undefined, { code, reason });
  }

  private async iframeMessage(method: string, callback?: (err: any, data: any) => any, ...params: any): Promise<any> {
    this.logger("iframeMessage request:", method, params);
    const response = await this.dmz.send({ type: "WEB3_REQUEST", data: { method, params } });
    this.logger("iframeMessage response", response);
    if (callback) {
      try {
        callback(null, response);
      } catch (err) {
        console.error("error in callback", err);
      }
    }
    return response.data;
  }
}
