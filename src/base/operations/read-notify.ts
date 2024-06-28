import { SecureSocket } from "../index.js";
import { SocketPayload } from "@ugursahinkaya/shared-types";
import { sendMessage } from "./send-message.js";

export function readNotify(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  base: SecureSocket<any>,
  receivedPayload: SocketPayload<string>
) {
  if (!receivedPayload.sender) {
    return;
  }
  base.logger.debug(
    `messageReceived > sending blank message for read notification to ${receivedPayload.sender}`
  );
  const { sender, queryId } = receivedPayload;
  const payload: SocketPayload = {
    receiver: sender,
    queryId,
    workerProcess: { messageReceived: true },
    body: { localTime: new Date() },
  };
  void sendMessage(base, {
    payload,
  });
}
