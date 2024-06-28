import { arrayBufferToBase64 } from '@ugursahinkaya/utils';
import { SecureSocket } from '../index.js';
import { sendMessage } from './send-message.js';

export async function sendPing(base: SecureSocket<any>, receiver: string) {
  return new Promise<void>((resolve, reject) => {
    const salt = base.crypto.randomBytes(16);
    void sendMessage(base, {
      payload: {
        receiver,
        body: arrayBufferToBase64(salt),
        process: 'ping',
        callback: () => {
          base.crypto
            .setSecretSalt(receiver, salt)
            .then(() => {
              resolve();
            })
            .catch(reject);
        }
      }
    });
  });
}
