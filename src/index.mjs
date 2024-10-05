import http from "http";
import httpProxy from "http-proxy";
import fsp from "fs/promises";
import path from "path";
import yaml from "js-yaml";

import { fileURLToPath } from "url";

const tokenMap = new Map();

(async () => {
  for (const { token, authority, auth_list } of await readYAML()) {
    if (auth_list.length === 0) {
      continue;
    }
    const handledAuthority = authority.replace(/\/$/, "");
    tokenMap.set(token, {
      index: 0,
      authority: handledAuthority,
      authList: auth_list,
    });
  }
  const proxy = httpProxy.createProxyServer({});
  http.createServer((req, res) => {
    try {
      const proxyURL = handleRequest(req);
      proxy.web(req, res, {
        target: proxyURL,
        ws: true,
        changeOrigin: true,
      });
      proxy.on("error", (err, req, res) => {
        if (!res.headersSent) {
          res.writeHead(500, {
            "Content-Type": "application/json"
          });
          res.end(JSON.stringify({ error: String(err) }));
        }
        console.error("Proxy Error:", err);
      });
    } catch (error) {
      console.error("Connection Error:", error);
      res.writeHead(500, {
        "Content-Type": "application/json"
      });
      res.end(JSON.stringify({ error: `Internal Error: ${error}` }));
    }
  }).listen(3000, () => {
    console.log("Proxy server running on port 3000");
  });

})().catch((err) => {
  console.error(err);
  progress.exit(1);
});

async function readYAML() {
  const __dirname = fileURLToPath(new URL(".", import.meta.url));
  const filePath = path.join(__dirname, "..", "config", "proxy.yaml");
  const fileContents = await fsp.readFile(filePath, 'utf8');
  return yaml.load(fileContents);
}

function handleRequest(req) {
  let url = req.url;
  let auth = "";
  // Remove the protocol and host (includes port) from the url
  url = url.replace(/^\w+:\/\/[^\/][\w\.]+(:\d+)?/, "");

  console.log("Request URL:", url);

  const authorization = req.headers.authorization;
  if (authorization) {
    auth = authorization.replace(/^Bearer\s+/, "");
    const value = tokenMap.get(auth);
    if (value) {
      const { authority, authList } = value;
      console.log("Access Key", value.index + 1, "of", auth);
      url = `${authority}${url}`;
      auth = authList[value.index];
      value.index += 1;
      if (value.index >= authList.length) {
        value.index = 0;
      }
    } else {
      auth = "";
    }
  }
  if (auth) {
    req.headers.authorization = `Bearer ${auth}`;
  }
  return new URL(url);
}

// 服务器任何 promise unhandled 报错，不崩溃，直接打印报错
process.on("unhandledRejection", (err) => {
  console.error("Unhandled Promise Rejection:", err);
});