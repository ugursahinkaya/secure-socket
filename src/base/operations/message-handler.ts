import { SocketPayload, AnyRecord } from "@ugursahinkaya/shared-types";
import { SecureSocket } from "../index.js";
import {
  checkCallBack,
  exchangeKey,
  generateAndSendKey,
  importKey,
  sendMessage,
} from "./index.js";
async function returnError(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  base: SecureSocket<any>,
  payload: {
    error?: string;
    sender?: string;
    queryId?: string;
  }
) {
  if (!payload.sender || !payload.error || !payload.queryId) {
    return;
  }
  const receiver = payload.sender;
  const query = base.activeQueries[payload.queryId];
  if (query) {
    query.reject(`Error: ${payload.error}`);
    return;
  }
  sendMessage(base, {
    payload: {
      queryId: payload.queryId,
      receiver,
      body: {
        error: `Error: ${payload.error}`,
      },
    },
  });
}
export async function messageHandler(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  base: SecureSocket<any>,
  args: {
    isFirstMessage: boolean;
    event: { data: string | Buffer | ArrayBuffer | Buffer[] | Blob };
  }
) {
  const { isFirstMessage, event } = args;
  let payloadBuffer = event.data;
  base.socketLogger.debug(isFirstMessage, ["messageHandler", "isFirstMessage"]);

  if (typeof payloadBuffer === "string") {
    base.socketLogger.error(
      "String messages are not supported",
      "messageHandler"
    );
    return;
  }
  if (Array.isArray(payloadBuffer)) {
    payloadBuffer = Buffer.concat(payloadBuffer);
  }
  if (payloadBuffer instanceof Blob) {
    payloadBuffer = await payloadBuffer.arrayBuffer();
  }
  // When we connect to the server, the first message will be the public key of the server
  // We need to store this key and send our own public key back to the server to complete the handshake
  if (isFirstMessage || !base.crypto.keyMap.get("serverPBL")) {
    base.socketLogger.error(
      "Server public key not found, handshaking with the server",
      "messageHandler"
    );
    try {
      base.socketLogger.debug(
        "Generating a new key pair for the server",
        "messageHandler"
      );
      await base.crypto.generateKey("server");
      const serverPublicKey = payloadBuffer;
      base.socketLogger.debug(
        "importing incoming server public key",
        "messageHandler"
      );
      await base.crypto.importPublicKey(serverPublicKey, "server");
      base.socketLogger.debug(
        "exporting our public key to send to the server",
        "messageHandler"
      );
      const selfPublicKey = await base.crypto.exportKey("server");
      const selfPublicKeyBlob = new Blob([selfPublicKey], {
        type: "text/plain",
      });
      base.socketLogger.debug(
        "sending our public key to the server",
        "messageHandler"
      );
      await base.socket?.send(await selfPublicKeyBlob.arrayBuffer());
      base.socketLogger.info(
        "Handshake with the server completed",
        "messageHandler"
      );
      void base.call("socketReady");
    } catch (error) {
      base.socketLogger.error(
        "Could not handshake with the server, closing the socket",
        "messageHandler"
      );
      base.socket?.close(1000);
    }
    return;
  }
  let payload: SocketPayload<string>;
  try {
    payload = (await base.crypto.decryptBuffer(
      payloadBuffer,
      true,
      "server"
    )) as unknown as SocketPayload<string>;
  } catch (error) {
    base.socketLogger.error(error as string, ["messageHandler"]);
    payload = {
      error: "Could not decrypt the message",
      body: "",
      queryId: "",
    };
  }
  base.socketLogger.info(payload.queryId as string, [
    "messageHandler",
    "queryId",
  ]);
  if (payload.error) {
    base.socketLogger.error("Error in message", "messageHandler");
    void returnError(base, payload);
    return;
  }
  if (!payload) {
    return;
  }

  if (payload.workerProcess?.newKey) {
    await generateAndSendKey(base, payload);
    await checkCallBack(base, payload);
    return;
  }

  if (payload.workerProcess?.importKey) {
    await importKey(base, payload);
    await checkCallBack(base, payload);
    return;
  }

  if (payload.workerProcess?.messageReceived) {
    await checkCallBack(base, payload);
    return;
  }

  if (
    payload.queryId &&
    payload.sender &&
    !base.crypto.hasSecret(payload.sender)
  ) {
    base.socketLogger.warn(
      `No key for ${payload.sender}, needs handshake, trying to force exchange key`,
      "messageHandler"
    );
    try {
      await exchangeKey(base, {
        receiver: payload.sender,
        queryId: payload.queryId,
      });
    } catch (error) {
      base.socketLogger.error("Could not exchange key", "messageHandler");
    }

    return;
  }

  let decryptedMessage: string | AnyRecord;
  if (!payload.sender) {
    throw new Error("where is the sender of the messsage?");
  }
  try {
    const messageBuffer = base.crypto.base64ToArrayBuffer(payload.body);
    base.socketLogger.debug(
      `Attempting to decrypt the message ${payload.sender}`,
      "messageHandler"
    );
    decryptedMessage = await base.crypto.decryptBuffer(
      messageBuffer,
      true,
      payload.sender
    );
  } catch {
    decryptedMessage = payload.body;
  }
  const finalPayload = {
    ...payload,
    body: decryptedMessage,
    receiver: payload.receiver as string,
  };

  base.socketLogger.trace(finalPayload, [
    "messageHandler",
    `${payload.sender} says `,
  ]);
  // readNotify(base, payload);
  if (finalPayload && finalPayload.process) {
    await base.eventRouter
      .runMiddlewares(finalPayload.process, finalPayload, "result")
      .catch((errorIndex) => {
        base.socketLogger.error(
          `${errorIndex}. postEvents returned false for ${finalPayload.process}. This not blocks sending result for requester. Anyway check everything is ok.`,
          "messageHandler"
        );
        return;
      });
  }
  if (
    finalPayload.process &&
    finalPayload.process !== "subscribe" &&
    !base.isOperationExists(finalPayload.process)
  ) {
    base.socketLogger.debug(
      `Operation ${finalPayload.process} not found`,
      "messageHandler"
    );
    void returnError(base, {
      ...payload,
      error: `Operation ${finalPayload.process} not found`,
    });
    return;
  }
  if (finalPayload.process && finalPayload.sender) {
    const {
      call,
      after,
      payload: callPayload,
    } = finalPayload.body as unknown as {
      call: string;
      after: string;
      payload: any;
    };
    if (call && after && finalPayload.process === "subscribe") {
      base.eventRouter.setAfter(
        after,
        async () => {
          const output = await base.call(
            call,
            { payload: callPayload, referer: base.socketUrl },
            callPayload
          );
          void sendMessage(base, {
            payload: {
              body: output,
              receiver: finalPayload.sender,
              process: "next",
            },
          });
          return true;
        },
        finalPayload.sender
      );
      base.socketLogger.debug(`subscribe ${call} completed`, "messageHandler");
      void sendMessage(base, {
        payload: {
          body: { process: `subscribe ${call}`, status: true },
          receiver: finalPayload.sender,
        },
      });
      return;
    }

    try {
      base.socketLogger.debug(finalPayload.process, [
        "messageHandler",
        "Calling",
      ]);
      const output = await base.call(
        finalPayload.process,
        {
          //TODO: Why?
          payload: JSON.parse(JSON.stringify(finalPayload)),
          referer: base.socketUrl,
        },
        finalPayload.body
      );
      base.socketLogger.debug(output, ["messageHandler", "Call output"]);
      void base.eventRouter
        .checkPostEvents(finalPayload.process, output)
        .catch((errorIndex) => {
          base.socketLogger.error(
            `${errorIndex}. postEvents returned false for ${finalPayload.process}. This not blocks sending result for requester. Anyway check everything is ok.`,
            "messageHandler"
          );
        });
      void base.eventRouter
        .checkPostEvents(finalPayload.process, output, finalPayload.sender)
        .catch((errorIndex) => {
          base.socketLogger.error(
            `${errorIndex}. postEvents returned false for ${finalPayload.process} (defined with ${finalPayload.sender}). This not blocks sending result for requester. Anyway check everything is ok.`,
            "messageHandler"
          );
        });

      if (output !== undefined) {
        base.socketLogger.debug("Respnse sending", "messageHandler");
        void sendMessage(base, {
          payload: { body: output, receiver: finalPayload.sender },
        });
      }
    } catch (error) {
      base.socketLogger.error(error as string, [
        "messageHandler",
        "callOperation error",
      ]);
      void sendMessage(base, {
        payload: {
          body: { error: "callOperation error" },
          receiver: finalPayload.sender,
        },
      });
    }
    return;
  }
  await checkCallBack(base, finalPayload);
}
