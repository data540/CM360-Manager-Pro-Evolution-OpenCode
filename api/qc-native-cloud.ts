import { handleQcNativeCloud } from "./_qcNativeCloud";

export const config = {
  runtime: "nodejs",
};

export default async function handler(req: any, res: any) {
  return handleQcNativeCloud(req, res);
}
