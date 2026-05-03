import type { NextConfig } from "next";
import { withVolato } from "@volatodev/nextjs";

const config: NextConfig = {
  reactStrictMode: true,
};

export default withVolato(config);
