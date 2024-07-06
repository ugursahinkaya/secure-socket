import typescript from "rollup-plugin-typescript2";
import dts from "rollup-plugin-dts";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import terser from "@rollup/plugin-terser";
import replace from "@rollup/plugin-replace";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export default [
  {
    input: "src/index.ts",
    output: {
      file: "dist/index.node.js",
      format: "es",
    },
    plugins: [
      typescript({
        tsconfig: "./tsconfig.json",
      }),
      terser(),
    ],
  },
  {
    input: "src/index.ts",
    output: {
      file: "dist/index.js",
      format: "es",
    },

    plugins: [
      replace({
        preventAssignment: true,
        delimiters: ["", ""],
        "import { WebSocket } from 'ws';": "",
        "ws.WebSocket;": "WebSocket",
      }),
      typescript({
        tsconfig: "./tsconfig.json",
      }),

      terser(),
    ],
  },
  {
    input: "src/index.ts",
    output: {
      file: "dist/secure-socket.umd.js",
      format: "umd",
      name: "YUM",
      extend: true,
      globals: {
        "@ugursahinkaya/event-manager": "YUM",
        "@ugursahinkaya/crypto-lib": "YUM",
        "@ugursahinkaya/secure-auth": "YUM",
        "@ugursahinkaya/utils": "YUM",
      },
    },
    external: [
      "@ugursahinkaya/crypto-lib",
      "@ugursahinkaya/event-manager",
      "@ugursahinkaya/secure-auth",
      "@ugursahinkaya/utils",
    ],

    plugins: [
      replace({
        preventAssignment: true,
        delimiters: ["", ""],
        "import { WebSocket } from 'ws';": "",
        "ws.WebSocket": "WebSocket",
      }),
      typescript({
        tsconfig: "./tsconfig.json",
      }),
      terser(),
    ],
  },
  {
    input: resolve(__dirname, "dist/index.d.ts"),
    output: {
      file: "dist/index.d.ts",
      format: "es",
    },
    plugins: [dts()],
  },
];
