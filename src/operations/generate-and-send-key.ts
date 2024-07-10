import { SecureSocket } from "../index.js";
import { SocketPayload } from "@ugursahinkaya/shared-types";
import { sendMessage } from "./send-message.js";

export async function generateAndSendKey(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  base: SecureSocket<any>,
  receivedPayload: SocketPayload<string>
) {
  if (!receivedPayload.sender || !receivedPayload.queryId) {
    return;
  }
  const { queryId, sender } = receivedPayload;
  let { body } = receivedPayload;
  // TODO: check why this quatas occur
  body = body.replace('"', "").replace('"', "");
  await base.crypto.generateKey(sender);
  const senderPublicKey = base.crypto.base64ToArrayBuffer(body);
  await base.crypto.importPublicKey(senderPublicKey, sender);
  const selfPublicKey = await base.crypto.exportKey(sender);
  const b64Key = base.crypto.arrayBufferToBase64(selfPublicKey);
  const payload = {
    receiver: sender,
    queryId,
    workerProcess: { importKey: true },
    body: b64Key,
  };

  const originalQuery = base.activeQueries[queryId];
  base.socketLogger.debug(receivedPayload.sender, ["generateAndSendKey"]);
  await sendMessage(base, {
    payload,
    encrypt: false,
  });
  if (originalQuery && originalQuery.payload.queryId) {
    base.activeQueries[originalQuery.payload.queryId] = originalQuery;
  }
}
