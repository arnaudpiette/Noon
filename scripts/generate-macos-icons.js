"use strict";

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const png2icons = require("png2icons");

const root = path.resolve(__dirname, "..");
const source = path.join(root, "assets", "branding", "noon-app-icon-source.png");
const icons = path.join(root, "assets", "icons");
const iconset = path.join(icons, "noon.iconset");
const montserratUltraBold = path.join(
  process.env.HOME || "",
  "Library",
  "Fonts",
  "FontBase",
  "Montserrat-Black.ttf"
);

async function transparentLetter(width, height) {
  const { data, info } = await sharp(source)
    .trim({ background: "#ffffff", threshold: 14 })
    .resize({ width, height, fit: "inside" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let index = 0; index < data.length; index += 4) {
    const distanceFromWhite = 255 - Math.min(
      data[index],
      data[index + 1],
      data[index + 2]
    );
    data[index + 3] = Math.round(
      data[index + 3] * distanceFromWhite / 255
    );
  }

  return sharp(data, { raw: info }).png().toBuffer();
}

async function makeApplicationMaster() {
  // Gabarit Dock macOS : carré arrondi comparable à Chrome et WhatsApp,
  // avec un N Montserrat UltraBold contenu dans les marges existantes.
  if (!fs.existsSync(montserratUltraBold)) {
    throw new Error(`Police Montserrat UltraBold introuvable : ${montserratUltraBold}`);
  }

  const embeddedFont = fs.readFileSync(montserratUltraBold).toString("base64");
  const applicationIcon = Buffer.from(`
    <svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <style>
          @font-face {
            font-family: "Noon Montserrat";
            src: url("data:font/ttf;base64,${embeddedFont}") format("truetype");
            font-weight: 900;
          }
        </style>
        <linearGradient id="noonGradient" gradientUnits="userSpaceOnUse"
          x1="310" y1="735" x2="710" y2="285">
          <stop offset="0%" stop-color="#000000"/>
          <stop offset="54%" stop-color="#0b3d08"/>
          <stop offset="100%" stop-color="#43ff12"/>
        </linearGradient>
        <mask id="mirroredN">
          <rect width="1024" height="1024" fill="#000000"/>
          <text x="512" y="720" text-anchor="middle"
            transform="translate(1024 0) scale(-1 1)"
            font-family="Noon Montserrat" font-size="600" font-weight="900"
            fill="#ffffff" stroke="#ffffff" stroke-width="28"
            stroke-linejoin="round" paint-order="stroke fill">N</text>
        </mask>
      </defs>
      <rect x="92" y="92" width="840" height="840" rx="190"
        fill="#ffffff" stroke="#e8e8e6" stroke-width="4"/>
      <rect width="1024" height="1024"
        fill="url(#noonGradient)" mask="url(#mirroredN)"/>
    </svg>
  `);

  return sharp(applicationIcon).png().toBuffer();
}

async function makeTrayIcon(size, template) {
  const { data, info } = await sharp(source)
    .trim({ background: "#ffffff", threshold: 14 })
    .resize({ width: Math.max(1, size - 2), height: Math.max(1, size - 2), fit: "contain" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let index = 0; index < data.length; index += 4) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const sourceAlpha = data[index + 3];
    const distanceFromWhite = 255 - Math.min(red, green, blue);
    data[index + 3] = Math.round(sourceAlpha * distanceFromWhite / 255);
    if (template) {
      data[index] = 0;
      data[index + 1] = 0;
      data[index + 2] = 0;
    }
  }

  const fileName = template
    ? `noonTemplate${size === 32 ? "@2x" : ""}.png`
    : `noonTray${size === 32 ? "@2x" : ""}.png`;
  await sharp(data, { raw: info })
    .extend({
      top: 1,
      bottom: 1,
      left: 1,
      right: 1,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toFile(path.join(icons, fileName));
}

async function main() {
  if (!fs.existsSync(source)) throw new Error(`Source introuvable : ${source}`);
  fs.mkdirSync(iconset, { recursive: true });
  const applicationMaster = await makeApplicationMaster();
  fs.writeFileSync(path.join(icons, "noon-1024.png"), applicationMaster);

  for (const size of [16, 32, 128, 256, 512]) {
    await sharp(applicationMaster).resize(size, size)
      .png().toFile(path.join(iconset, `icon_${size}x${size}.png`));
    await sharp(applicationMaster).resize(size * 2, size * 2)
      .png().toFile(path.join(iconset, `icon_${size}x${size}@2x.png`));
  }

  await Promise.all([
    makeTrayIcon(16, false),
    makeTrayIcon(32, false),
    makeTrayIcon(16, true),
    makeTrayIcon(32, true),
  ]);

  const icns = png2icons.createICNS(
    fs.readFileSync(path.join(icons, "noon-1024.png")),
    png2icons.BICUBIC,
    0
  );
  if (!icns) throw new Error("La conversion ICNS a échoué.");
  fs.writeFileSync(path.join(icons, "noon.icns"), icns);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
