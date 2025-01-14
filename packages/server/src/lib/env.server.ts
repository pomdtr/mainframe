import { bool, envsafe, num, str, url } from "envsafe";
import dotenv from "dotenv";

if (typeof window === "undefined") {
  // TODO: Review the path
  dotenv.config({ path: "../../.env" });
}

export const env = envsafe({
  PORT: num({ default: 8745 }),
  CLOUDFLARED_TOKEN: str({ default: "", allowEmpty: true }),
  TUNNEL_BASE_API_URL: str({ default: "", allowEmpty: true }),
  COOKIE_SECRET: str({ default: "", allowEmpty: true }),
  AUTH_LOGIN_URL: str({ default: "", allowEmpty: true }),
  AUTH_LOGOUT_URL: str({ default: "", allowEmpty: true }),
  APP_URL: url({ default: "http://localhost:8744" }),
  NANGO_PRIVATE_KEY: str({ default: "", allowEmpty: true }),
  OPENAI_API_KEY: str({ default: "", allowEmpty: true }),

  VITE_AUTH_PASS: bool({ default: true }),
  VITE_API_URL: url({
    default: "https://api.mainframe.so",
    devDefault: "http://localhost:8745",
  }),
});
