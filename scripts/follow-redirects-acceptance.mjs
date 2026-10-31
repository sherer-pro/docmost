import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import path from "node:path";

export async function verifyRedirectCredentialIsolation(client) {
  const listen = async (server) => {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    return server.address().port;
  };
  const close = async (server) => {
    server.closeAllConnections();
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  };
  const target = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(request.headers));
  });
  const targetPort = await listen(target);
  let originPort;
  const origin = createServer((request, response) => {
    if (request.url === "/same-target") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(request.headers));
      return;
    }
    response.writeHead(302, {
      location:
        request.url === "/same"
          ? `http://127.0.0.1:${originPort}/same-target`
          : `http://127.0.0.1:${targetPort}/`,
    });
    response.end();
  });
  try {
    originPort = await listen(origin);
    const get = (pathname, headers, sensitiveHeaders) =>
      new Promise((resolve, reject) => {
        const request = client.http.get(
          {
            hostname: "127.0.0.1",
            port: originPort,
            path: pathname,
            headers,
            sensitiveHeaders,
            maxRedirects: 2,
          },
          (response) => {
            let body = "";
            response.on("data", (chunk) => {
              body += chunk;
            });
            response.on("error", reject);
            response.on("end", () => {
              try {
                resolve(JSON.parse(body));
              } catch (error) {
                reject(error);
              }
            });
          },
        );
        request.on("error", reject);
        request.setTimeout(5000, () =>
          request.destroy(new Error("Synthetic redirect timed out")),
        );
      });
    const headers = {
      "X-Synthetic-Credential": "NOT_A_REAL_CREDENTIAL",
      "X-Harmless": "retained",
      Authorization: "Bearer NOT_A_REAL_CREDENTIAL",
      Cookie: "synthetic=NOT_A_REAL_CREDENTIAL",
    };
    const crossRealm = runInNewContext('["X-Synthetic-Credential"]');
    assert.equal(Array.isArray(crossRealm), true);
    assert.equal(crossRealm instanceof Array, false);
    const same = await get("/same", headers, crossRealm);
    assert.equal(
      Boolean(same["x-synthetic-credential"]),
      true,
      "Same-origin redirects must preserve the custom header",
    );
    assert.equal(
      Boolean(same.authorization),
      true,
      "Same-origin redirects must preserve ordinary authorization",
    );
    const observations = [];
    for (const representation of ["object", "array"]) {
      for (const realm of ["ordinary", "cross-realm"]) {
        const received = await get(
          "/cross",
          representation === "object"
            ? { ...headers }
            : Object.entries(headers).flat(),
          realm === "ordinary" ? ["X-Synthetic-Credential"] : crossRealm,
        );
        const label = `${representation} headers and ${realm} sensitive names`;
        assert.equal(
          Boolean(received["x-synthetic-credential"]),
          false,
          `${label}: custom credential crossed origins`,
        );
        assert.equal(
          Boolean(received.authorization),
          false,
          `${label}: authorization crossed origins`,
        );
        assert.equal(
          Boolean(received.cookie),
          false,
          `${label}: cookie crossed origins`,
        );
        assert.equal(
          received["x-harmless"],
          "retained",
          `${label}: unrelated header was lost`,
        );
        observations.push({
          representation,
          realm,
          credentialDisclosed: false,
          unrelatedHeaderRetained: true,
        });
      }
    }
    return {
      passed: true,
      loopbackOnly: true,
      sameOriginPreserved: true,
      crossOrigin: observations,
    };
  } finally {
    await close(origin);
    await close(target);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const require = createRequire(import.meta.url);
  const serverRequire = createRequire(
    new URL("../apps/server/package.json", import.meta.url),
  );
  const postmarkRequire = createRequire(serverRequire.resolve("postmark"));
  const axiosRequire = createRequire(postmarkRequire.resolve("axios"));
  const client = process.argv[2]
    ? require(path.resolve(process.argv[2]))
    : axiosRequire("follow-redirects");
  console.log(JSON.stringify(await verifyRedirectCredentialIsolation(client)));
}
