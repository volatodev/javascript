import type { NextConfig } from "next";

import { withVolato } from "./volato/withVolato";

const config: NextConfig = {
  reactStrictMode: true,
};

export default withVolato(config)
