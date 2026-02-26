import { proxyRequest } from "../_proxy";

export default async function handler(req: any, res: any) {
  return proxyRequest(req, res, "https://dfareporting.googleapis.com");
}
