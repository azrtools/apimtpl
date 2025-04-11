import { defineConfig } from "eslint/config";
import js from "@eslint/js";
import pluginJest from "eslint-plugin-jest";

export default defineConfig([
  {
    files: ["**/*.js"],
    languageOptions: {
      globals: {
        console: "readonly",
        ...pluginJest.environments.globals.globals
      }
    },
    plugins: { js, jest: pluginJest },
    extends: ["js/recommended"],
    rules: {
      "no-console": "off"
    }
  }
]);
