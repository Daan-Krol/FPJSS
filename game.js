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

let debugMode = false;

let mapGraphics;

let keys;
let shootKey;

let player;
let playerAngle = 0;

let rayGraphics;

let enemies = [];

let score = 0;
let scoreText;

const enemySpeed = 0.2;

const rotationSpeed = 0.05;
const playerSpeed = 2;

const FOV = Math.PI / 3;
const RAY_LENGTH = 1000;

// Screen dimensions.
const SCREEN_WIDTH = 640;
const SCREEN_HEIGHT = 480;
const HORIZON = SCREEN_HEIGHT / 2;

// The projection scale used for walls and enemies.
//
// A 60-world-unit wall projects to:
//     60 * PROJECTION_PLANE_DISTANCE / distance
//
// Therefore PROJECTION_PLANE_DISTANCE is 500 and the old
// PROJECTION_SCALE of 30000 is kept for compatibility.
const PROJECTION_SCALE = 30000;
const PROJECTION_PLANE_DISTANCE = PROJECTION_SCALE / TILE_SIZE;

// The camera is halfway up a 60-unit wall.
const CAMERA_HEIGHT = TILE_SIZE / 2;

// The raw textures.
let brickImage;
let grassImage;

// Grass texture pixel data. We sample this directly for floor casting.
let grassPixels;
let grassWidth;
let grassHeight;

// Our canvas used for the raycasted scene.
let sceneCtx;
let sceneTexture;

function preload() {
    this.load.image("brick", "assets/bricks256.png");
    this.load.image("grass", "assets/grass256.png");
    this.load.image("gun", "assets/gun256.png");
}

function create() {
    // A blank canvas we manually draw the ceiling, floor and walls onto.
    sceneTexture = this.textures.createCanvas(
        "scene",
        SCREEN_WIDTH,
        SCREEN_HEIGHT
    );

    sceneCtx = sceneTexture.getContext();

    this.add.image(0, 0, "scene").setOrigin(0, 0);

    // Grab the actual image sources.
    brickImage = this.textures.get("brick").getSourceImage();
    grassImage = this.textures.get("grass").getSourceImage();

    // Copy the grass texture into pixel data once.
    // We reuse this every frame instead of creating a repeating
    // canvas pattern, because the floor needs perspective.
    const grassCanvas = document.createElement("canvas");
    grassCanvas.width = grassImage.width;
    grassCanvas.height = grassImage.height;

    const grassCtx = grassCanvas.getContext("2d", {
        willReadFrequently: true
    });

    grassCtx.drawImage(grassImage, 0, 0);

    grassWidth = grassImage.width;
    grassHeight = grassImage.height;
    grassPixels = grassCtx.getImageData(
        0,
        0,
        grassWidth,
        grassHeight
    ).data;

    scoreText = this.add.text(20, 20, "Score: 0", {
        fontSize: "24px",
        color: "#ffffff"
    });

    mapGraphics = this.add.graphics();

    // Debug top-down map.
    for (let y = 0; y < map.length; y++) {
        for (let x = 0; x < map[y].length; x++) {
            if (map[y][x] === "#") {
                const wall = this.add.rectangle(
                    x * TILE_SIZE + TILE_SIZE / 2,
                    y * TILE_SIZE + TILE_SIZE / 2,
                    TILE_SIZE,
                    TILE_SIZE,
                    0x0000ff
                );

                wall.setVisible(debugMode);
            }
        }
    }

    player = this.add.circle(
        2 * TILE_SIZE + TILE_SIZE / 2,
        3 * TILE_SIZE + TILE_SIZE / 2,
        10,
        0x00ff00
    );

    enemies = [];

    for (let i = 0; i < 5; i++) {
        enemies.push(spawnEnemy());
    }

    player.setVisible(debugMode);

    keys = this.input.keyboard.createCursorKeys();

    shootKey = this.input.keyboard.addKey(
        Phaser.Input.Keyboard.KeyCodes.SPACE
    );

    // Enemies are drawn on top of the raycasted scene.
    rayGraphics = this.add.graphics();

    // Fixed gun at the bottom center.
    this.add.image(SCREEN_WIDTH / 2, SCREEN_HEIGHT, "gun")
        .setOrigin(0.5, 1)
        .setDisplaySize(220, 220);
}

function update() {
    if (Phaser.Input.Keyboard.JustDown(shootKey)) {
        shoot();
    }

    if (keys.left.isDown) {
        playerAngle -= rotationSpeed;
    }

    if (keys.right.isDown) {
        playerAngle += rotationSpeed;
    }

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

    // Keep the player inside the map and out of walls.
    const newMapX = Math.floor(newX / TILE_SIZE);
    const newMapY = Math.floor(newY / TILE_SIZE);

    if (
        newMapY >= 0 &&
        newMapY < map.length &&
        newMapX >= 0 &&
        newMapX < map[0].length &&
        map[newMapY][newMapX] !== "#"
    ) {
        player.x = newX;
        player.y = newY;
    }

    for (const enemy of enemies) {
        moveEnemy(enemy);
    }

    // Render the 3D scene.
    renderScene();

    // Draw enemies on top of the scene.
    rayGraphics.clear();

    // Farthest first, closest last.
    const sortedEnemies = [...enemies].sort((a, b) => {
        const distA = Math.hypot(
            a.x - player.x,
            a.y - player.y
        );

        const distB = Math.hypot(
            b.x - player.x,
            b.y - player.y
        );

        return distB - distA;
    });

    for (const enemy of sortedEnemies) {
        drawEnemy(enemy);
    }
}

function renderScene() {
    // Ceiling.
    sceneCtx.fillStyle = "#333333";
    sceneCtx.fillRect(
        0,
        0,
        SCREEN_WIDTH,
        HORIZON
    );

    // The important part:
    // render the grass as actual world-space floor pixels.
    //
    // Every map tile is TILE_SIZE x TILE_SIZE world units.
    // The complete 256x256 grass texture is mapped onto each
    // individual map tile, so the texture repeats seamlessly
    // as the player walks around the world.
    renderFloor();

    // Render walls over the floor.
    for (let x = 0; x < SCREEN_WIDTH; x += 2) {
        const rayAngle =
            playerAngle -
            FOV / 2 +
            (x / SCREEN_WIDTH) * FOV;

        const hit = castRay(rayAngle);

        // Remove fisheye distortion.
        const distance =
            hit.distance *
            Math.cos(rayAngle - playerAngle);

        const wallHeight =
            PROJECTION_SCALE / Math.max(distance, 0.001);

        // Which horizontal part of the brick texture was hit.
        const sourceX =
            hit.textureX * brickImage.width;

        sceneCtx.drawImage(
            brickImage,
            sourceX,
            0,
            1,
            brickImage.height,
            x,
            HORIZON - wallHeight / 2,
            2,
            wallHeight
        );
    }

    // Push all canvas changes to Phaser.
    sceneTexture.refresh();
}

function renderFloor() {
    // Get the current frame's pixels.
    const imageData = sceneCtx.getImageData(
        0,
        HORIZON,
        SCREEN_WIDTH,
        SCREEN_HEIGHT - HORIZON
    );

    const pixels = imageData.data;

    // Render two screen columns at a time, matching the wall
    // renderer. This cuts the floor work roughly in half.
    for (let x = 0; x < SCREEN_WIDTH; x += 2) {
        const relativeAngle =
            -FOV / 2 +
            (x / SCREEN_WIDTH) * FOV;

        const rayAngle = playerAngle + relativeAngle;

        const rayCos = Math.cos(rayAngle);
        const raySin = Math.sin(rayAngle);

        // cos(relativeAngle) converts the ground distance in the
        // camera's forward direction into distance along this ray.
        const angleCorrection = Math.cos(relativeAngle);

        for (let screenY = HORIZON + 1; screenY < SCREEN_HEIGHT; screenY++) {
            const row = screenY - HORIZON;

            // Standard floor-casting equation:
            //
            // forwardDistance =
            //     cameraHeight * projectionPlaneDistance / row
            //
            // This is the distance from the player to the floor
            // measured in the camera's forward direction.
            const forwardDistance =
                (CAMERA_HEIGHT * PROJECTION_PLANE_DISTANCE) / row;

            // Convert forward distance into distance along this
            // particular screen column's ray.
            const rayDistance =
                forwardDistance / Math.max(angleCorrection, 0.001);

            // Find the actual world-space point on the floor.
            const worldX =
                player.x + rayCos * rayDistance;

            const worldY =
                player.y + raySin * rayDistance;

            // Find which 60x60 map tile we're inside.
            const tileLocalX =
                positiveModulo(worldX, TILE_SIZE);

            const tileLocalY =
                positiveModulo(worldY, TILE_SIZE);

            // Map that 60x60 world-space tile onto the complete
            // 256x256 grass image.
            const textureX = Math.floor(
                (tileLocalX / TILE_SIZE) * grassWidth
            );

            const textureY = Math.floor(
                (tileLocalY / TILE_SIZE) * grassHeight
            );

            const grassIndex =
                (textureY * grassWidth + textureX) * 4;

            const r = grassPixels[grassIndex];
            const g = grassPixels[grassIndex + 1];
            const b = grassPixels[grassIndex + 2];
            const a = grassPixels[grassIndex + 3];

            const localY =
                screenY - HORIZON;

            // Fill both columns with the same sample.
            // This matches the x += 2 wall rendering above.
            for (let column = 0; column < 2; column++) {
                const localX = x + column;

                if (localX >= SCREEN_WIDTH) {
                    continue;
                }

                const pixelIndex =
                    (localY * SCREEN_WIDTH + localX) * 4;

                pixels[pixelIndex] = r;
                pixels[pixelIndex + 1] = g;
                pixels[pixelIndex + 2] = b;
                pixels[pixelIndex + 3] = a;
            }
        }
    }

    // Write the floor pixels back to the scene canvas.
    sceneCtx.putImageData(
        imageData,
        0,
        HORIZON
    );
}

function positiveModulo(value, divisor) {
    return ((value % divisor) + divisor) % divisor;
}

function castRay(angle) {
    let rayX = player.x;
    let rayY = player.y;

    for (
        let distance = 0;
        distance < RAY_LENGTH;
        distance++
    ) {
        rayX += Math.cos(angle);
        rayY += Math.sin(angle);

        const mapX = Math.floor(rayX / TILE_SIZE);
        const mapY = Math.floor(rayY / TILE_SIZE);

        // Treat the outside of the map as a wall.
        if (
            mapY < 0 ||
            mapY >= map.length ||
            mapX < 0 ||
            mapX >= map[0].length
        ) {
            return {
                distance,
                textureX: 0
            };
        }

        if (map[mapY][mapX] === "#") {
            // Position inside the wall tile.
            const hitXInTile =
                positiveModulo(rayX, TILE_SIZE);

            const hitYInTile =
                positiveModulo(rayY, TILE_SIZE);

            // Determine whether we hit a vertical or horizontal face.
            const distFromEdgeX =
                Math.min(
                    hitXInTile,
                    TILE_SIZE - hitXInTile
                );

            const distFromEdgeY =
                Math.min(
                    hitYInTile,
                    TILE_SIZE - hitYInTile
                );

            let textureX;

            if (distFromEdgeX < distFromEdgeY) {
                textureX =
                    hitYInTile / TILE_SIZE;
            } else {
                textureX =
                    hitXInTile / TILE_SIZE;
            }

            return {
                distance,
                textureX
            };
        }
    }

    return {
        distance: RAY_LENGTH,
        textureX: 0
    };
}

function spawnEnemy() {
    // Pick a random open tile.
    let tileX;
    let tileY;

    do {
        tileX = Math.floor(
            Math.random() * map[0].length
        );

        tileY = Math.floor(
            Math.random() * map.length
        );
    } while (map[tileY][tileX] === "#");

    return {
        x: tileX * TILE_SIZE + TILE_SIZE / 2,
        y: tileY * TILE_SIZE + TILE_SIZE / 2
    };
}

function moveEnemy(enemy) {
    const dx = player.x - enemy.x;
    const dy = player.y - enemy.y;

    const distance = Math.sqrt(
        dx * dx + dy * dy
    );

    // Avoid dividing by zero if an enemy reaches the player.
    if (distance < 0.001) {
        return;
    }

    const newX =
        enemy.x + (dx / distance) * enemySpeed;

    const newY =
        enemy.y + (dy / distance) * enemySpeed;

    const mapX = Math.floor(newX / TILE_SIZE);
    const mapY = Math.floor(newY / TILE_SIZE);

    if (
        mapY >= 0 &&
        mapY < map.length &&
        mapX >= 0 &&
        mapX < map[0].length &&
        map[mapY][mapX] !== "#"
    ) {
        enemy.x = newX;
        enemy.y = newY;
    }
}

function shoot() {
    let rayX = player.x;
    let rayY = player.y;

    for (
        let distance = 0;
        distance < RAY_LENGTH;
        distance++
    ) {
        rayX += Math.cos(playerAngle);
        rayY += Math.sin(playerAngle);

        const mapX = Math.floor(
            rayX / TILE_SIZE
        );

        const mapY = Math.floor(
            rayY / TILE_SIZE
        );

        // Shot stops when it reaches a wall.
        if (
            mapY < 0 ||
            mapY >= map.length ||
            mapX < 0 ||
            mapX >= map[0].length ||
            map[mapY][mapX] === "#"
        ) {
            return;
        }

        // Check enemies.
        for (
            let i = enemies.length - 1;
            i >= 0;
            i--
        ) {
            const enemy = enemies[i];

            const enemyDistance = Math.sqrt(
                (enemy.x - rayX) ** 2 +
                (enemy.y - rayY) ** 2
            );

            if (enemyDistance < 15) {
                enemies.splice(i, 1);

                score += 1;
                scoreText.setText(
                    "Score: " + score
                );

                // Replace the killed enemy.
                enemies.push(spawnEnemy());

                return;
            }
        }
    }
}

function drawEnemy(enemy) {
    const dx = enemy.x - player.x;
    const dy = enemy.y - player.y;

    const distance = Math.sqrt(
        dx * dx + dy * dy
    );

    let enemyAngle = Math.atan2(dy, dx);

    let relativeAngle =
        enemyAngle - playerAngle;

    while (relativeAngle > Math.PI) {
        relativeAngle -= Math.PI * 2;
    }

    while (relativeAngle < -Math.PI) {
        relativeAngle += Math.PI * 2;
    }

    if (Math.abs(relativeAngle) > FOV / 2) {
        return;
    }

    // Don't draw enemies hidden behind walls.
    const wallDistance =
        castRay(enemyAngle).distance;

    if (distance > wallDistance) {
        return;
    }

    const screenX =
        SCREEN_WIDTH / 2 +
        (relativeAngle / (FOV / 2)) *
        (SCREEN_WIDTH / 2);

    // Remove fisheye distortion.
    const correctedDistance =
        distance * Math.cos(relativeAngle);

    const wallHeightHere =
        PROJECTION_SCALE /
        Math.max(correctedDistance, 0.001);

    const enemyHeight =
        wallHeightHere * 0.6;

    const enemyWidth =
        enemyHeight * 0.5;

    // Feet sit on the projected floor.
    const floorY =
        HORIZON + wallHeightHere / 2;

    rayGraphics.fillStyle(0xff0000);

    rayGraphics.fillRect(
        screenX - enemyWidth / 2,
        floorY - enemyHeight,
        enemyWidth,
        enemyHeight
    );
}
