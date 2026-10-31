import test from "node:test";
import assert from "node:assert/strict";

import { managedToolContainerIds, parseManagedToolContainers } from "../src/managed-tool-containers.js";

test("managed container parser accepts only labeled naming convention output", () => {
  const output = [
    JSON.stringify({ ID: "abcdef123456", Names: "raa-tool-42-abcd", Image: "node:20", Status: "Up 2 minutes", State: "running", Size: "12kB" }),
    JSON.stringify({ ID: "123456abcdef", Names: "database", Image: "postgres:17", Status: "Up 1 day", State: "running", Size: "1GB" })
  ].join("\n");
  assert.deepEqual(parseManagedToolContainers(output), [{
    id: "abcdef123456",
    name: "raa-tool-42-abcd",
    image: "node:20",
    status: "Up 2 minutes",
    state: "running",
    size: "12kB"
  }]);
});

test("managed container IDs are unique and validated", () => {
  assert.deepEqual(managedToolContainerIds([
    { id: "abcdef123456" }, { id: "abcdef123456" }, { id: "not-an-id" }
  ]), ["abcdef123456"]);
});