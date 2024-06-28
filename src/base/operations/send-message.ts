import { SocketPayload, AnyRecord } from "@ugursahinkaya/shared-types";
import { randomString } from "@ugursahinkaya/utils";
import { exchangeKey } from "./exchange-key.js";
import { SecureSocket } from "../index.js";

export async function sendMessage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  base: SecureSocket<any>,
  args: { payload: SocketPayload<AnyRecord | string>; encrypt?: boolean }
) {
  async function send(
    resolve: (value: unknown) => void,
    reject: (reason?: unknown) => void
  ) {
    const { payload } = args;
    let { encrypt } = args;
    if (encrypt !== false) {
      encrypt = true;
    }
    if (!payload.receiver) {
      reject("Receiver not found");
      throw new Error("sendMessage: receiver not found");
    }
    if (!base.socket) {
      await base.socketInit();
    }

    if (base.socket?.readyState !== 1) {
      base.logger.error("Socket is not open trying to reconnect");
      await base.socketInit();
    }

    if (!payload.queryId || payload.queryId === "") {
      payload.queryId = randomString();
    }
    base.logger.log("sendMessage", encrypt, payload);
    const originalPayload = { ...payload };
    let e2e = true;
    if (
      encrypt &&
      !base.crypto.hasSecret(payload.receiver) &&
      !payload.workerProcess?.newKey &&
      !payload.workerProcess?.importKey
    ) {
      e2e = false;
      base.logger.error(
        `sendMessage > No secret key found for ${payload.receiver}, trying to establish secure connection`
      );

      try {
        const res = await exchangeKey(base, {
          receiver: payload.receiver,
          queryId: payload.queryId + "e2e",
        });

        e2e = res === true ? true : false;
      } catch (error) {
        const err = `sendMessage > Error while establishing secure connection with ${payload.receiver}`;
        reject(err);
        throw base.logger.error(err, error);
      }
    }
    if (!e2e) {
      // reject("secure connection not established");
      return;
    }
    if (
      !payload.callback &&
      !payload.workerProcess?.newKey &&
      !payload.workerProcess?.importKey
    ) {
      payload.callback = async (result: SocketPayload) => {
        base.logger.log("sendMessage > oldQuery callback", result);
        if (result.workerProcess?.importKey && payload.queryId) {
          const oldQuery = base.activeQueries[payload.queryId];
          if (oldQuery) {
            oldQuery.payload.queryId = randomString();
            await sendMessage(base, { payload: oldQuery.payload });
          }
        } else if (result.workerProcess?.newKey) {
          await sendMessage(base, { payload: originalPayload });
        } else {
          resolve(result.body);
        }
      };
    }

    base.activeQueries[payload.queryId] = { payload, resolve, reject };
    if (encrypt && payload.receiver) {
      if (payload.receiver !== "server") {
        payload.body = await base.crypto.encrypt(
          JSON.stringify(payload.body),
          payload.receiver,
          true
        );
      }
    }
    const message = JSON.stringify(payload);
    const [ciphertext, iv] = await base.crypto.encrypt(message, "server");

    const blob = new Blob([iv, ciphertext], { type: "text/plain" });
    base.socket!.send(await blob.arrayBuffer());
  }
  return new Promise((resolve, reject) => {
    void send(resolve, reject);
  });
}
