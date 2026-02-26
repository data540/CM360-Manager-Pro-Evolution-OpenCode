import { proxyRequest } from "../_proxy";

export default async function handler(req: any, res: any) {
  return proxyRequest(req, res, "https://www.googleapis.com");
}
