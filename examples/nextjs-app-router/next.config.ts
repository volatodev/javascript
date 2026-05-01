import type { NextConfig } from "next";
import { withVolato } from "@volatodev/nextjs/server";

const config: NextConfig = {
  reactStrictMode: true,
};

export default withVolato(config);
