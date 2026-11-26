import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_BYTES } from "../../config/limits";
import { processFile } from "./pipeline";

const image = (width: number, height: number, background = "#3366cc") =>
  sharp({ create: { width, height, channels: 3, background } });

const sizeOf = async (data: Buffer) => {
  const { width, height, format } = await sharp(data).metadata();
  return { width, height, format };
};

describe("processFile", () => {
  it.each(["jpeg", "png", "webp"] as const)("turns a %s into a JPEG", async (format) => {
    const input = await image(640, 480).toFormat(format).toBuffer();
    const result = await processFile(input, `image/${format}`);

    expect(result.contentType).toBe("image/jpeg");
    expect(await sizeOf(result.data)).toEqual({ width: 640, height: 480, format: "jpeg" });
  });

  it("shrinks a wide picture to 1600 px, keeping its shape", async () => {
    const input = await image(4000, 3000).jpeg().toBuffer();
    expect(await sizeOf((await processFile(input, "image/jpeg")).data)).toEqual({
      width: 1600,
      height: 1200,
      format: "jpeg",
    });
  });

  it("never enlarges a small picture", async () => {
    const input = await image(300, 200).jpeg().toBuffer();
    expect((await sizeOf((await processFile(input, "image/jpeg")).data)).width).toBe(300);
  });

  it("turns a sideways phone photo upright, then limits the new width", async () => {
    // Stored 2400 x 1000 with "rotate 90°": a person sees 1000 x 2400.
    const input = await image(2400, 1000).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const result = await processFile(input, "image/jpeg");

    expect(await sizeOf(result.data)).toMatchObject({ width: 1000, height: 2400 });
    expect((await sharp(result.data).metadata()).orientation).toBeUndefined();
  });

  it("really rotates the pixels", async () => {
    // Left half red, right half blue, with "turn upside down".
    const input = await image(200, 100, "#0000ff")
      .composite([{ input: await image(100, 100, "#ff0000").png().toBuffer(), left: 0, top: 0 }])
      .jpeg()
      .toBuffer();
    const flipped = await sharp(input).withMetadata({ orientation: 3 }).jpeg().toBuffer();
    const { data } = await sharp((await processFile(flipped, "image/jpeg")).data)
      .raw()
      .toBuffer({ resolveWithObject: true });

    expect(data[0]).toBeLessThan(80); // top left is now blue
    expect(data[2]).toBeGreaterThan(180);
  });

  it("removes hidden details such as the GPS position", async () => {
    const input = await image(100, 100)
      .jpeg()
      .withExif({ IFD0: { Copyright: "secret-owner" } })
      .toBuffer();
    expect(input.includes("secret-owner")).toBe(true);

    expect((await processFile(input, "image/jpeg")).data.includes("secret-owner")).toBe(false);
  });

  it("makes see-through areas white", async () => {
    const input = await sharp({
      create: { width: 10, height: 10, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const { data } = await sharp((await processFile(input, "image/png")).data)
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(250);
  });

  it("keeps a PDF exactly as it is", async () => {
    const pdf = Buffer.from("%PDF-1.7\nanything at all\n%%EOF");
    expect(await processFile(pdf, "application/pdf")).toEqual({
      data: pdf,
      contentType: "application/pdf",
    });
  });

  it.each([
    ["a GIF", Buffer.from("GIF89a......"), "image/gif"],
    ["HEIC", Buffer.from("\0\0\0\x18ftypheic....."), "image/heic"],
    ["SVG", Buffer.from("<svg/>"), "image/svg+xml"],
    ["text called a JPEG", Buffer.from("hello"), "image/jpeg"],
    ["a PDF called a JPEG", Buffer.from("%PDF-1.7"), "image/jpeg"],
    ["an empty file", Buffer.alloc(0), "image/jpeg"],
  ])("refuses %s", async (_label, data, type) => {
    await expect(processFile(data, type)).rejects.toMatchObject({
      statusCode: 415,
      code: "UNSUPPORTED_FILE_TYPE",
    });
  });

  it("refuses a damaged picture", async () => {
    const damaged = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from("junk")]);
    await expect(processFile(damaged, "image/jpeg")).rejects.toMatchObject({
      code: "INVALID_IMAGE",
    });
  });

  it("refuses a small file that unpacks into an enormous picture", async () => {
    const bomb = await image(9000, 9000).png().toBuffer();
    expect(bomb.length).toBeLessThan(MAX_UPLOAD_BYTES);
    await expect(processFile(bomb, "image/png")).rejects.toMatchObject({ code: "INVALID_IMAGE" });
  });

  it.each(["image/jpeg", "application/pdf"])("refuses more than 8 MB (%s)", async (type) => {
    const big = Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(MAX_UPLOAD_BYTES)]);
    await expect(processFile(big, type)).rejects.toMatchObject({
      statusCode: 413,
      code: "FILE_TOO_LARGE",
    });
  });
});
