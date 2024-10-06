import http from "http";
import httpProxy from "http-proxy";
import fsp from "fs/promises";
import path from "path";
import yaml from "js-yaml";
import querystring from "querystring";

import { fileURLToPath } from "url";

const tokenMap = new Map();

(async () => {
  const { port, records } = await readYAML();
  for (const { token, authority, auth_list } of records) {
    if (auth_list.length === 0) {
      continue;
    }
    const handledAuthority = authority.replace(/\/$/, "");
    tokenMap.set(token, {
      index: Math.ceil(auth_list.length * Math.random()),
      authority: handledAuthority,
      authList: auth_list,
    });
  }
  const proxy = httpProxy.createProxyServer({
    ws: true,
  });
  http.createServer((req, res) => {
    try {
      const targetURL = handleRequest(req);
      proxy.web(req, res, { target: targetURL });
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
  }).listen(port, () => {
    console.log(`Proxy server running on port ${port}`);
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
  let auth_in_query = false;
  let auth_in_headers_key = "";
  let targetURL = "";
  let queryParts = {};

  const cells = url.split("?");

  if (cells.length > 1) {
    queryParts = querystring.parse(cells.pop());
    const key = queryParts.key;
    if (key) {
      auth = key;
      auth_in_query = true;
      delete queryParts.key;
    }
  }
  // Remove the protocol and host (includes port) from the url
  url = url.replace(/^\w+:\/\/[^\/][\w\.]+(:\d+)?/, "");
  url = cells.join("?");

  if (req.headers.authorization) {
    auth = req.headers.authorization.replace(/^Bearer\s+/, "");
    auth_in_headers_key = "authorization";
  } else if (req.headers["x-goog-api-key"]) {
    auth = req.headers["x-goog-api-key"];
    auth_in_headers_key = "x-goog-api-key";
  }
  if (!auth) {
    throw new Error("Cannot read auth from request");
  }
  const value = tokenMap.get(auth);
  if (!value) {
    throw new Error(`cannot find authority for ${auth}`);
  }
  const { authority, authList } = value;
  console.log("Access Key", value.index + 1, "of", auth);

  targetURL = authority;
  auth = authList[value.index];
  // remove the protocol
  req.headers.host = targetURL.replace(/^\w+:\/\//, "")
                              .replace(/\/[^/]+/, "");

  value.index += 1;
  if (value.index >= authList.length) {
    value.index = 0;
  }
  if (auth_in_query) {
    queryParts.key = auth;
  }
  if (auth_in_headers_key) {
    if (auth_in_headers_key === "authorization") {
      auth = `Bearer ${auth}`;
    }
    req.headers[auth_in_headers_key] = auth;
  }
  for (const _ in queryParts) {
    url += `?${querystring.stringify(queryParts)}`;
    break;
  }
  req.url = url;
  return targetURL;
}

// 服务器任何 promise unhandled 报错，不崩溃，直接打印报错
process.on("unhandledRejection", (err) => {
  console.error("Unhandled Promise Rejection:", err);
});