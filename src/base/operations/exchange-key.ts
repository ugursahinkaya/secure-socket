import { SocketPayload } from "@ugursahinkaya/shared-types";
import { randomString } from "@ugursahinkaya/utils";
import { SecureSocket } from "../index.js";
import { sendMessage } from "./send-message.js";

export async function exchangeKey(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  base: SecureSocket<any>,
  args: { receiver: string; queryId: string }
) {
  const { receiver } = args;
  let { queryId } = args;
  if (queryId) {
    base.logger.log(`exchangeKey > for ${receiver} ${queryId}`);
  } else {
    base.logger.log(`exchangeKey > for ${receiver}`);
  }
  if (!queryId) {
    queryId = randomString();
  }
  await base.crypto.generateKey(receiver);
  const selfPublicKey = await base.crypto.exportKey(receiver);

  const payload: SocketPayload<string> = {
    receiver,
    queryId: randomString(),
    workerProcess: { newKey: true },
    body: base.crypto.arrayBufferToBase64(selfPublicKey),
  };

  base.logger.log("payload", payload);
  return new Promise<true>((resolve, reject) => {
    void sendMessage(base, {
      payload,
    })
      .then(() => {
        resolve(true);
      })
      .catch((err) => {
        reject(err);
      });
  });
}
