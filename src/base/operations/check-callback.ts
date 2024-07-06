import { SecureSocket } from "../index.js";
import { SocketPayload } from "@ugursahinkaya/shared-types";

export async function checkCallBack(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  base: SecureSocket<any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: SocketPayload<any>
) {
  if (payload.queryId) {
    const waitingMessage = base.activeQueries[payload.queryId];
    if (waitingMessage) {
      if (waitingMessage.payload.callback) {
        base.socketLogger.debug(
          "checkCallBack > calling callback",
          JSON.parse(JSON.stringify(payload))
        );
        delete base.activeQueries[payload.queryId];
        await waitingMessage.payload.callback(payload);
      } else {
        delete base.activeQueries[payload.queryId];
        waitingMessage.resolve(payload.body);
      }
    }
  }
}
