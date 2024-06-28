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
  base.logger.log(
    "onMessage event triggered",
    "isFirstMessage",
    isFirstMessage
  );

  if (typeof payloadBuffer === "string") {
    base.logger.error("String messages are not supported");
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
    base.logger.debug(
      "Server public key not found, handshaking with the server"
    );
    try {
      base.logger.debug("Generating a new key pair for the server");
      await base.crypto.generateKey("server");
      const serverPublicKey = payloadBuffer;
      base.logger.debug("importing incoming server public key");
      await base.crypto.importPublicKey(serverPublicKey, "server");
      base.logger.debug("exporting our public key to send to the server");
      const selfPublicKey = await base.crypto.exportKey("server");
      const selfPublicKeyBlob = new Blob([selfPublicKey], {
        type: "text/plain",
      });
      base.logger.debug("sending our public key to the server");
      await base.socket?.send(await selfPublicKeyBlob.arrayBuffer());
      base.logger.log("Handshake with the server completed");
      void base.call("socketReady");
    } catch (error) {
      base.logger.error(
        "Could not handshake with the server, closing the socket",
        error
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
    base.logger.log("error", error);
    payload = {
      error: "Could not decrypt the message",
      body: "",
      queryId: "",
    };
  }
  base.logger.log("received", payload.queryId, payload);
  if (payload.error) {
    base.logger.error("Error in message", payload);
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
    base.logger.warn(
      `No key for ${payload.sender}, needs handshake, trying to force exchange key`
    );
    try {
      await exchangeKey(base, {
        receiver: payload.sender,
        queryId: payload.queryId,
      });
    } catch (error) {
      base.logger.error("Could not exchange key", error);
    }

    return;
  }

  let decryptedMessage: string | AnyRecord;
  if (!payload.sender) {
    throw new Error("where is the sender of the messsage?");
  }
  try {
    const messageBuffer = base.crypto.base64ToArrayBuffer(payload.body);
    base.logger.debug(`Attempting to decrypt the message ${payload.sender}`);
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

  base.logger.debug(`${payload.sender} says `, finalPayload);
  // readNotify(base, payload);
  if (finalPayload && finalPayload.process) {
    await base.eventRouter
      .runMiddlewares(finalPayload.process, finalPayload, "result")
      .catch((errorIndex) => {
        base.logger.error(
          `${errorIndex}. postEvents returned false for ${finalPayload.process}. This not blocks sending result for requester. Anyway check everything is ok.`
        );
        return;
      });
  }
  if (
    finalPayload.process &&
    finalPayload.process !== "subscribe" &&
    !base.isOperationExists(finalPayload.process)
  ) {
    base.logger.debug(`Operation ${finalPayload.process} not found`);
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
      base.logger.debug(`subscribe ${call} completed`);
      void sendMessage(base, {
        payload: {
          body: { process: `subscribe ${call}`, status: true },
          receiver: finalPayload.sender,
        },
      });
      return;
    }

    try {
      base.logger.debug("Calling", finalPayload.process);
      const output = await base.call(
        finalPayload.process,
        {
          //TODO: Why?
          payload: JSON.parse(JSON.stringify(finalPayload)),
          referer: base.socketUrl,
        },
        finalPayload.body
      );
      base.logger.debug("Call output:", output);
      void base.eventRouter
        .checkPostEvents(finalPayload.process, output)
        .catch((errorIndex) => {
          base.logger.error(
            `${errorIndex}. postEvents returned false for ${finalPayload.process}. This not blocks sending result for requester. Anyway check everything is ok.`
          );
        });
      void base.eventRouter
        .checkPostEvents(finalPayload.process, output, finalPayload.sender)
        .catch((errorIndex) => {
          base.logger.error(
            `${errorIndex}. postEvents returned false for ${finalPayload.process} (defined with ${finalPayload.sender}). This not blocks sending result for requester. Anyway check everything is ok.`
          );
        });

      if (output !== undefined) {
        base.logger.debug("Respnse sending");
        void sendMessage(base, {
          payload: { body: output, receiver: finalPayload.sender },
        });
      }
    } catch (error) {
      base.logger.error("callOperation error:", error);
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
