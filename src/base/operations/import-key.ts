import { SecureSocket } from "../index.js";
import { SocketPayload } from "@ugursahinkaya/shared-types";

export async function importKey(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  base: SecureSocket<any>,
  receivedPayload: SocketPayload<string>
) {
  if (!receivedPayload.sender || !receivedPayload.queryId) {
    return;
  }
  const { sender, body } = receivedPayload;
  const senderPublicKey = base.crypto.base64ToArrayBuffer(body);
  base.logger.log(
    `importKey > importing key from ${receivedPayload.sender}`,
    body,
    senderPublicKey
  );

  await base.crypto.importPublicKey(senderPublicKey, sender);

  const originalQuery = base.activeQueries[receivedPayload.queryId];
  if (originalQuery && originalQuery.payload.queryId) {
    base.activeQueries[originalQuery.payload.queryId] = originalQuery;
  }
}
