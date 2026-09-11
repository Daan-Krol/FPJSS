const config = {
    type: Phaser.AUTO,

    width: 800,
    height: 600,

    scene: {
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

const enemySpeed = 0.1;

const rotationSpeed = 0.05;
const playerSpeed = 2;

const FOV = Math.PI / 3;
const RAY_LENGTH = 500;
const SCREEN_WIDTH = 800;

// This is the single "projection scale" used to turn a distance into a
// pixel height on screen. Walls AND enemies must all use this same
// number, or things won't line up with the floor.
const PROJECTION_SCALE = 30000;

function create() {
    scoreText = this.add.text(20, 20, "Score: 0", {
        fontSize: "24px",
        color: "#ffffff"
    });

    mapGraphics = this.add.graphics();

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
    shootKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    rayGraphics = this.add.graphics();
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

    if (map[Math.floor(newY / TILE_SIZE)][Math.floor(newX / TILE_SIZE)] !== "#") {
        player.x = newX;
        player.y = newY;
    }

    for (const enemy of enemies) {
        moveEnemy(enemy);
    }

    rayGraphics.clear();

    rayGraphics.fillStyle(0x0000ff);

    for (let x = 0; x < SCREEN_WIDTH; x += 2) {

        const rayAngle =
            playerAngle - FOV / 2 +
            (x / SCREEN_WIDTH) * FOV;

        let distance = castRay(rayAngle);

        // Fix fisheye distortion
        distance *= Math.cos(rayAngle - playerAngle);

        const wallHeight = PROJECTION_SCALE / distance;

        rayGraphics.fillRect(
            x,
            300 - wallHeight / 2,
            2,
            wallHeight
        );
    }

    // Draw farthest enemies first, closest last, so closer enemies
    // overlap farther ones properly instead of the other way round.
    const sortedEnemies = [...enemies].sort((a, b) => {
        const distA = Math.hypot(a.x - player.x, a.y - player.y);
        const distB = Math.hypot(b.x - player.x, b.y - player.y);
        return distB - distA;
    });

    for (const enemy of sortedEnemies) {
        drawEnemy(enemy);
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

        if (map[mapY][mapX] === "#") {
            return distance;
        }
    }

    return RAY_LENGTH;
}

function spawnEnemy() {
    // Keep picking random tiles until we land on open floor (not a wall)
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

    const newX = enemy.x + (dx / distance) * enemySpeed;
    const newY = enemy.y + (dy / distance) * enemySpeed;

    const mapX = Math.floor(newX / TILE_SIZE);
    const mapY = Math.floor(newY / TILE_SIZE);

    if (map[mapY][mapX] !== "#") {
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

        // Hit a wall → shot stops
        if (map[mapY][mapX] === "#") {
            return;
        }

        // Check all enemies
        for (let i = enemies.length - 1; i >= 0; i--) {
            const enemy = enemies[i];

            const enemyDistance = Math.sqrt(
                (enemy.x - rayX) ** 2 +
                (enemy.y - rayY) ** 2
            );

            if (enemyDistance < 15) {
                enemies.splice(i, 1);

                score += 1;
                scoreText.setText("Score: " + score);

                // Replace the enemy that was just killed
                enemies.push(spawnEnemy());

                return;
            }
        }
    }
}

function drawEnemy(enemy) {
    const dx = enemy.x - player.x;
    const dy = enemy.y - player.y;

    const distance = Math.sqrt(dx * dx + dy * dy);

    let enemyAngle = Math.atan2(dy, dx);
    let relativeAngle = enemyAngle - playerAngle;

    while (relativeAngle > Math.PI) relativeAngle -= Math.PI * 2;
    while (relativeAngle < -Math.PI) relativeAngle += Math.PI * 2;

    if (Math.abs(relativeAngle) > FOV / 2) {
        return;
    }

    // Make sure a wall isn't blocking the view of this enemy
    const wallDistance = castRay(enemyAngle);
    if (distance > wallDistance) {
        return;
    }

    const screenX =
        SCREEN_WIDTH / 2 +
        (relativeAngle / (FOV / 2)) * (SCREEN_WIDTH / 2);

    // Remove fisheye distortion, same as the walls do
    const correctedDistance = distance * Math.cos(relativeAngle);

    // Use the SAME scale as the walls. This is what makes the enemy's
    // feet line up with the floor instead of floating.
    const wallHeightHere = PROJECTION_SCALE / correctedDistance;

    const enemyHeight = wallHeightHere * 0.6; // enemy a bit shorter than a wall
    const enemyWidth = enemyHeight * 0.5;

    // The floor at this distance is exactly where the wall column ends
    const floorY = 300 + wallHeightHere / 2;

    rayGraphics.fillStyle(0xff0000);

    rayGraphics.fillRect(
        screenX - enemyWidth / 2,
        floorY - enemyHeight, // draw UP from the floor, not centered on screen middle
        enemyWidth,
        enemyHeight
    );
}