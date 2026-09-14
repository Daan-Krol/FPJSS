const config = {
    type: Phaser.AUTO,
    width: 640,
    height: 480,
    scene: {
        preload: preload,
        create: create,
        update: update
    }
};

const game = new Phaser.Game(config);

const map = [
    "################",
    "#              #",
    "#   #######    #",
    "#   #     #    #",
    "#   #     #    #",
    "#       #      #",
    "#####   #  #####",
    "#       #      #",
    "#   #          #",
    "#   #   ####   #",
    "#       #      #",
    "#   ########   #",
    "#              #",
    "#    #    #    #",
    "#              #",
    "################"
];

const TILE_SIZE = 60;
const SCREEN_WIDTH = 640;
const SCREEN_HEIGHT = 480;
const HORIZON = SCREEN_HEIGHT / 2;

const FOV = Math.PI / 3;
const RAY_LENGTH = 1000;

const PROJECTION_SCALE = 30000;
const PROJECTION_PLANE_DISTANCE = PROJECTION_SCALE / TILE_SIZE;
const CAMERA_HEIGHT = TILE_SIZE / 2;

const playerSpeed = 2;
const rotationSpeed = 0.05;
const enemySpeed = 0.2;

let player;
let playerAngle = 0;

let keys;
let shootKey;

let enemies = [];
let score = 0;
let scoreText;

let debugMode = false;
let mapGraphics;
let rayGraphics;

let brickImage;
let grassImage;
let enemyImage;

let grassPixels;
let grassWidth;
let grassHeight;

let sceneCtx;
let sceneTexture;

function preload() {
    this.load.image("brick", "assets/bricks256.png");
    this.load.image("grass",  "assets/grass256.png");
    this.load.image("gun",    "assets/gun256.png");
    this.load.image("enemy",  "assets/enemy256.png");
}

function create() {
    sceneTexture = this.textures.createCanvas("scene", SCREEN_WIDTH, SCREEN_HEIGHT);
    sceneCtx = sceneTexture.getContext();
    this.add.image(0, 0, "scene").setOrigin(0, 0);

    brickImage = this.textures.get("brick").getSourceImage();
    grassImage = this.textures.get("grass").getSourceImage();
    enemyImage = this.textures.get("enemy").getSourceImage();

    const grassCanvas = document.createElement("canvas");
    grassCanvas.width  = grassImage.width;
    grassCanvas.height = grassImage.height;
    const grassCtx = grassCanvas.getContext("2d", { willReadFrequently: true });
    grassCtx.drawImage(grassImage, 0, 0);
    grassWidth  = grassImage.width;
    grassHeight = grassImage.height;
    grassPixels = grassCtx.getImageData(0, 0, grassWidth, grassHeight).data;

    scoreText = this.add.text(20, 20, "Score: 0", {
        fontSize: "24px",
        color: "#ffffff"
    }).setDepth(10);

    mapGraphics = this.add.graphics();
    for (let y = 0; y < map.length; y++) {
        for (let x = 0; x < map[y].length; x++) {
            if (map[y][x] === "#") {
                const wall = this.add.rectangle(
                    x * TILE_SIZE + TILE_SIZE / 2,
                    y * TILE_SIZE + TILE_SIZE / 2,
                    TILE_SIZE, TILE_SIZE,
                    0x0000ff
                );
                wall.setVisible(debugMode);
            }
        }
    }

    player = this.add.circle(
        2 * TILE_SIZE + TILE_SIZE / 2,
        3 * TILE_SIZE + TILE_SIZE / 2,
        10, 0x00ff00
    );
    player.setVisible(debugMode);

    for (let i = 0; i < 5; i++) {
        enemies.push(spawnEnemy());
    }

    keys     = this.input.keyboard.createCursorKeys();
    shootKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    rayGraphics = this.add.graphics();

    this.add.image(SCREEN_WIDTH / 2, SCREEN_HEIGHT, "gun")
        .setOrigin(0.5, 1)
        .setDisplaySize(220, 220);
}

function update() {
    if (Phaser.Input.Keyboard.JustDown(shootKey)) {
        shoot();
    }

    if (keys.left.isDown)  playerAngle -= rotationSpeed;
    if (keys.right.isDown) playerAngle += rotationSpeed;

    let newX = player.x;
    let newY = player.y;

    if (keys.up.isDown) {
        newX += Math.cos(playerAngle) * playerSpeed;
        newY += Math.sin(playerAngle) * playerSpeed;
    }
    if (keys.down.isDown) {
        newX -= Math.cos(playerAngle) * playerSpeed;
        newY -= Math.sin(playerAngle) * playerSpeed;
    }

    const newMapX = Math.floor(newX / TILE_SIZE);
    const newMapY = Math.floor(newY / TILE_SIZE);
    const insideMap =
        newMapY >= 0 && newMapY < map.length &&
        newMapX >= 0 && newMapX < map[0].length;

    if (insideMap && map[newMapY][newMapX] !== "#") {
        player.x = newX;
        player.y = newY;
    }

    for (const enemy of enemies) {
        moveEnemy(enemy);
    }

    renderScene();
}

function renderScene() {
    sceneCtx.fillStyle = "#e3e3ff";
    sceneCtx.fillRect(0, 0, SCREEN_WIDTH, HORIZON);

    renderFloor();

    for (let x = 0; x < SCREEN_WIDTH; x += 2) {
        const rayAngle = playerAngle - FOV / 2 + (x / SCREEN_WIDTH) * FOV;
        const hit = castRay(rayAngle);
        const distance = hit.distance * Math.cos(rayAngle - playerAngle);
        const wallHeight = PROJECTION_SCALE / Math.max(distance, 0.001);
        const sourceX = hit.textureX * brickImage.width;

        sceneCtx.drawImage(
            brickImage,
            sourceX, 0, 1, brickImage.height,
            x, HORIZON - wallHeight / 2, 2, wallHeight
        );
    }

    const sortedEnemies = [...enemies].sort((a, b) => {
        return Math.hypot(b.x - player.x, b.y - player.y)
             - Math.hypot(a.x - player.x, a.y - player.y);
    });
    for (const enemy of sortedEnemies) {
        drawEnemy(enemy);
    }

    sceneTexture.refresh();
}

function renderFloor() {
    const imageData = sceneCtx.getImageData(0, HORIZON, SCREEN_WIDTH, SCREEN_HEIGHT - HORIZON);
    const pixels = imageData.data;

    for (let x = 0; x < SCREEN_WIDTH; x += 2) {
        const relativeAngle = -FOV / 2 + (x / SCREEN_WIDTH) * FOV;
        const rayAngle = playerAngle + relativeAngle;
        const rayCos = Math.cos(rayAngle);
        const raySin = Math.sin(rayAngle);
        const angleCorrection = Math.cos(relativeAngle);

        for (let screenY = HORIZON + 1; screenY < SCREEN_HEIGHT; screenY++) {
            const row = screenY - HORIZON;
            const forwardDistance = (CAMERA_HEIGHT * PROJECTION_PLANE_DISTANCE) / row;
            const rayDistance = forwardDistance / Math.max(angleCorrection, 0.001);

            const worldX = player.x + rayCos * rayDistance;
            const worldY = player.y + raySin * rayDistance;

            const tileLocalX = positiveModulo(worldX, TILE_SIZE);
            const tileLocalY = positiveModulo(worldY, TILE_SIZE);
            const textureX = Math.floor((tileLocalX / TILE_SIZE) * grassWidth);
            const textureY = Math.floor((tileLocalY / TILE_SIZE) * grassHeight);

            const grassIndex = (textureY * grassWidth + textureX) * 4;
            const r = grassPixels[grassIndex];
            const g = grassPixels[grassIndex + 1];
            const b = grassPixels[grassIndex + 2];
            const a = grassPixels[grassIndex + 3];

            const localY = screenY - HORIZON;
            for (let col = 0; col < 2; col++) {
                const localX = x + col;
                if (localX >= SCREEN_WIDTH) continue;
                const i = (localY * SCREEN_WIDTH + localX) * 4;
                pixels[i]     = r;
                pixels[i + 1] = g;
                pixels[i + 2] = b;
                pixels[i + 3] = a;
            }
        }
    }

    sceneCtx.putImageData(imageData, 0, HORIZON);
}

function drawEnemy(enemy) {
    const dx = enemy.x - player.x;
    const dy = enemy.y - player.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    const enemyAngle = Math.atan2(dy, dx);
    let relativeAngle = enemyAngle - playerAngle;

    while (relativeAngle >  Math.PI) relativeAngle -= Math.PI * 2;
    while (relativeAngle < -Math.PI) relativeAngle += Math.PI * 2;

    if (Math.abs(relativeAngle) > FOV / 2) return;

    const wallDistance = castRay(enemyAngle).distance;
    if (distance > wallDistance) return;

    const screenX = SCREEN_WIDTH / 2 + (relativeAngle / (FOV / 2)) * (SCREEN_WIDTH / 2);
    const correctedDistance = distance * Math.cos(relativeAngle);
    const wallHeightHere = PROJECTION_SCALE / Math.max(correctedDistance, 0.001);
    const enemySize = wallHeightHere * 0.9;
    const floorY = HORIZON + wallHeightHere / 2;

    sceneCtx.drawImage(
        enemyImage,
        screenX - enemySize / 2,
        floorY - enemySize,
        enemySize,
        enemySize
    );
}

function spawnEnemy() {
    let tileX, tileY;
    do {
        tileX = Math.floor(Math.random() * map[0].length);
        tileY = Math.floor(Math.random() * map.length);
    } while (map[tileY][tileX] === "#");

    return {
        x: tileX * TILE_SIZE + TILE_SIZE / 2,
        y: tileY * TILE_SIZE + TILE_SIZE / 2
    };
}

function moveEnemy(enemy) {
    const dx = player.x - enemy.x;
    const dy = player.y - enemy.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < 0.001) return;

    const newX = enemy.x + (dx / distance) * enemySpeed;
    const newY = enemy.y + (dy / distance) * enemySpeed;

    const mapX = Math.floor(newX / TILE_SIZE);
    const mapY = Math.floor(newY / TILE_SIZE);

    const insideMap =
        mapY >= 0 && mapY < map.length &&
        mapX >= 0 && mapX < map[0].length;

    if (insideMap && map[mapY][mapX] !== "#") {
        enemy.x = newX;
        enemy.y = newY;
    }
}

function shoot() {
    let rayX = player.x;
    let rayY = player.y;

    for (let distance = 0; distance < RAY_LENGTH; distance++) {
        rayX += Math.cos(playerAngle);
        rayY += Math.sin(playerAngle);

        const mapX = Math.floor(rayX / TILE_SIZE);
        const mapY = Math.floor(rayY / TILE_SIZE);

        const outsideMap =
            mapY < 0 || mapY >= map.length ||
            mapX < 0 || mapX >= map[0].length;

        if (outsideMap || map[mapY][mapX] === "#") return;

        for (let i = enemies.length - 1; i >= 0; i--) {
            const enemy = enemies[i];
            const dist = Math.sqrt((enemy.x - rayX) ** 2 + (enemy.y - rayY) ** 2);

            if (dist < 15) {
                enemies.splice(i, 1);
                score += 1;
                scoreText.setText("Score: " + score);
                enemies.push(spawnEnemy());
                return;
            }
        }
    }
}

function castRay(angle) {
    let rayX = player.x;
    let rayY = player.y;

    for (let distance = 0; distance < RAY_LENGTH; distance++) {
        rayX += Math.cos(angle);
        rayY += Math.sin(angle);

        const mapX = Math.floor(rayX / TILE_SIZE);
        const mapY = Math.floor(rayY / TILE_SIZE);

        if (mapY < 0 || mapY >= map.length || mapX < 0 || mapX >= map[0].length) {
            return { distance, textureX: 0 };
        }

        if (map[mapY][mapX] === "#") {
            const hitXInTile = positiveModulo(rayX, TILE_SIZE);
            const hitYInTile = positiveModulo(rayY, TILE_SIZE);

            const distFromEdgeX = Math.min(hitXInTile, TILE_SIZE - hitXInTile);
            const distFromEdgeY = Math.min(hitYInTile, TILE_SIZE - hitYInTile);

            const textureX = distFromEdgeX < distFromEdgeY
                ? hitYInTile / TILE_SIZE
                : hitXInTile / TILE_SIZE;

            return { distance, textureX };
        }
    }

    return { distance: RAY_LENGTH, textureX: 0 };
}

function positiveModulo(value, divisor) {
    return ((value % divisor) + divisor) % divisor;
}
