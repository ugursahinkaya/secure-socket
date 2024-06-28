import {
  AnyRecord,
  Logger,
  SecureSocketOperations,
  SecureSocketOptions,
  SocketPayload,
} from "@ugursahinkaya/shared-types";
import { SecureAuth } from "@ugursahinkaya/secure-auth";
import { useEventRouter } from "@ugursahinkaya/event-manager";
import { CryptoLib } from "@ugursahinkaya/crypto-lib";
import { createLogger } from "./logger.js";
import { sendMessage, messageHandler } from "./operations/index.js";
import { sendPing } from "./operations/send-ping.js";
import { WebSocket } from "ws";
export class SecureSocket<
  TOperations extends SecureSocketOperations,
> extends SecureAuth<any> {
  protected isFirstMessage = true;
  logger: Logger;
  crypto: CryptoLib;
  socket?: WebSocket;
  socketUrl?: string;
  activeQueries: Record<
    string,
    {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      payload: SocketPayload<any, any>;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      resolve: (result: any) => void;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      reject: (reason: any) => void;
    }
  > = {};
  eventRouter = useEventRouter<
    {
      receiver: string;
      body?: string | Record<string, unknown>;
      context?: Record<string, unknown> | undefined;
    },
    SocketPayload<unknown>
  >();
  waitingPing = false;
  pingTimeout: any;
  pingInterval: any;
  lastSeen = new Date();
  constructor(args: SecureSocketOptions<TOperations>) {
    let { operations, authUrl, socketUrl, logger } = args;
    if (!authUrl) {
      throw new Error("authUrl must be provided");
    }
    if (!operations) {
      operations = {} as TOperations;
    }
    const { getRefreshToken, saveRefreshToken } = operations;
    if (!getRefreshToken || !saveRefreshToken) {
      throw new Error(
        "The getRefreshToken and saveRefreshToken methods must be provided. You must use these methods to store and retrieve the refreshToken."
      );
    }

    const authApiOperations = {
      ...operations,
      loggedOut: () => {
        console.log("loggedOut");
        this.socket?.close(1000);
      },
      loggedIn: (queryToken: string) => {
        console.log("loggedIn", queryToken);
        this.socketInit(queryToken);
      },
    };
    super(authUrl, authApiOperations);
    this.crypto = new CryptoLib();
    this.socketUrl = socketUrl;
    if (logger) {
      const { name } = logger;
      let { levels } = logger;

      if (!levels) {
        levels = ["error", "warn", "log"];
      }
      this.logger = createLogger(`${name} base`, levels);
    } else {
      this.logger = createLogger("SecureSocket", ["error", "warn", "log"]);
    }
  }

  async ping() {
    console.log("ping");
    if (new Date().getTime() - this.lastSeen.getTime() < 5 * 1000) {
      return;
    }
    if (this.waitingPing) {
      return;
    }
    sendPing(this, "server").then(() => {
      this.lastSeen = new Date();
      clearTimeout(this.pingTimeout);
      this.waitingPing = false;
    });
    this.waitingPing = true;
    this.pingTimeout = setTimeout(async () => {
      clearTimeout(this.pingTimeout);
      void this.socketInit();
    }, 2000);
  }

  async sendMessage(
    receiver: string,
    body: AnyRecord | string,
    context?: AnyRecord
  ) {
    if (context && context.process) {
      const allowed = this.eventRouter.runMiddlewares(context.process, {
        receiver,
        body,
        context,
      });
      if (!allowed) {
        return;
      }
    }
    const res = sendMessage(this, {
      payload: { ...context, receiver, body },
    });
    this.lastSeen = new Date();
    return res;
  }

  init = (token?: string) => {
    console.log("init");
    this.socket?.close(1000);
    if (!token) {
      token = this.queryTokenValue();
    }
    if (token === undefined) {
      return;
    }
    if (!this.socketUrl) {
      return;
    }
    console.log(this.socketUrl + token);
    this.logger.log("Socket init", this.socketUrl + token);
    if (!this.socket) {
      this.socket = new WebSocket(this.socketUrl + token);
    }
    this.socket.addEventListener("open", () => {
      this.lastSeen = new Date();
      this.logger.log("Connected");
      this.logger.debug("Connected event");
      void this.call("socketConnected");
      const interval = setInterval(() => {
        if (!this.socket || this.socket.readyState !== 1) {
          clearInterval(interval);
          return;
        }
        this.ping();
      }, 10000);
    });

    this.socket.addEventListener("close", (event: any) => {
      this.logger.log("Disconnected");
      this.logger.debug("Disconnected event", event);
      this.socket = undefined;
      if (event.code === 1000 || event.code === 1002) {
        return;
      }

      void this.call("socketDisconnect");
      setTimeout(() => {
        void this.socketInit();
      }, 3000);
    });

    this.socket.addEventListener("error", (event: any) => {
      console.log("socket error", event);
      this.logger.error("Error", event);
      void this.call(
        "socketError",
        {
          channel: "socket",
          secure: true,
        },
        event.error
      );
    });

    this.socket.addEventListener(
      "message",
      (event: { data: string | Buffer | ArrayBuffer | Buffer[] }) => {
        this.lastSeen = new Date();
        void messageHandler(this, {
          event,
          isFirstMessage: this.isFirstMessage,
        });
        this.isFirstMessage = false;
      }
    );
  };
  throttle<T extends (...args: any[]) => void>(
    func: T,
    limit: number
  ): (...args: Parameters<T>) => void {
    let inThrottle: boolean;

    return function (this: any, ...args: Parameters<T>): void {
      const context = this;

      if (!inThrottle) {
        func.apply(context, args);
        inThrottle = true;
        setTimeout(() => (inThrottle = false), limit);
      }
    };
  }
  socketInit = this.throttle(this.init, 3000);
}
