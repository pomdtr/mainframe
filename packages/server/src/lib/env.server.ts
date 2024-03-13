import { bool, envsafe, num, str } from "envsafe";
import dotenv from "dotenv";

if (typeof window === "undefined") {
  dotenv.config({ path: "../../.env" });
}

export const env = envsafe({
  PORT: num({ default: 8745 }),
  CLOUDFLARED_TOKEN: str({ default: "", allowEmpty: true }),
  TUNNEL_BASE_API_URL: str({ default: "", allowEmpty: true }),
  COOKIE_SECRET: str({ default: "", allowEmpty: true }),
  AUTH_LOGIN_URL: str({ default: "", allowEmpty: true }),
  AUTH_LOGOUT_URL: str({ default: "", allowEmpty: true }),

  VITE_AUTH_PASS: bool({ default: true }),
});
