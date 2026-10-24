import "./ambiente";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { verificarBanco } from "@/lib/saude";

afterAll(() => prisma.$disconnect());

describe("esqueleto", () => {
  it("o banco de teste responde", async () => {
    expect(await verificarBanco()).toBe(true);
  });

});
