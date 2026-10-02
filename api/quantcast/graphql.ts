import { handleQuantcastGraphql } from "../_quantcast";

export const config = {
  runtime: "nodejs",
};

export default async function handler(req: any, res: any) {
  return handleQuantcastGraphql(req, res);
}
