import { describe, it, expect } from "@jest/globals";
import request from "supertest";
import { readFileSync } from "fs";
import path from "path";
import { TestData } from "../constants/test-data.js";

const api = request(TestData.BASE_URL);

describe("GET /version", () => {
  it("returns 200 without a cookie (unauthenticated)", async () => {
    const res = await api.get("/version");
    expect(res.status).toBe(200);
  });

  it("returns exactly a version field, matching package.json", async () => {
    const pkg = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
      version: string;
    };
    const res = await api.get("/version");
    expect(Object.keys(res.body)).toEqual(["version"]);
    expect(res.body.version).toBe(pkg.version);
  });

  it("the version is a semver-shaped string", async () => {
    const res = await api.get("/version");
    expect(res.body.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
