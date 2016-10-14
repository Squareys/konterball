import TweenMax from 'gsap';
import {STATE, MODE, INITIAL_CONFIG, EVENT} from './constants';
import Physics from './physics';
import Hud from './hud';
import SoundManager from './sound-manager';
import $ from 'jquery';
import WebVRManager from './webvr-manager';
import Util from './webvr-manager/util';

import Table from './models/table';
import Paddle from './models/paddle';
import Net from './models/net';
import Ball from './models/ball';
import BiggerBalls from './powerup/bigger-balls';
import Time from './util/time';

const DEBUG_MODE = false;

export default class Scene {
  constructor(emitter, communication) {
    this.emitter = emitter;
    this.time = new Time();

    this.communication = communication;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.controls = null;
    this.controller = null;
    this.effect = null;
    this.textureLoader = new THREE.TextureLoader();
    this.textureLoader.setPath('/models/');
    this.objLoader = new THREE.OBJLoader();
    this.objLoader.setPath('/models/');
    this.table = null;
    this.display = null;
    this.manager = null;
    this.gamePad = null;
    this.controller1 = null;
    this.controller2 = null;
    this.raycaster = null;
    this.tablePlane = null;
    this.controllerRay = null;
    this.net = null;
    this.tabActive = true;
    this.ball = null;
    this.physicsDebugRenderer = null;
    this.resetBallTimeout = null;
    this.state = STATE.PRELOADER;
    this.ballHasHitEnemyTable = false;
    this.resetTimeoutDuration = 1500;

    this.paddleTween = null;
    this.hitAvailable = true;

    this.playerRequestedRestart = false;
    this.opponentRequestedRestart = false;

    this.playerRequestedCountdown = false;
    this.opponentRequestedCountdown = false;
    this.mousemove = this.mousemove.bind(this);

    this.viewport = {
      width: $(document).width(),
      height: $(document).height(),
    };

    this.score = {
      self: 0,
      opponent: 0,
    };

    this.config = Object.assign({}, INITIAL_CONFIG);
    this.physics = new Physics(
      this.config,
      this.emitter
    );
    this.sound = new SoundManager();

    this.frameNumber = 0;
    this.totaltime = 0;
    this.lastRender = 0;
  }

  setup() {
    return new Promise((resolve, reject) => {
      this.setupThree();
      this.table = Table(this.scene, this.config);
      this.setupVR();
      this.net = Net(this.scene, this.config);

      this.renderer.domElement.requestPointerLock = this.renderer.domElement.requestPointerLock
        || this.renderer.domElement.mozRequestPointerLock;
      this.renderer.domElement.onclick = () => {
        this.renderer.domElement.requestPointerLock();
      };
      document.addEventListener('pointerlockchange', () => {
        if (document.pointerLockElement === this.renderer.domElement) {
          document.addEventListener("mousemove", this.mousemove, false);
        } else {
          document.removeEventListener("mousemove", this.mousemove);
          this.setPaddlePosition(0, 1.3, this.config.paddlePositionZ);
        }
      }, false);

      this.physics.setupWorld();

      if (DEBUG_MODE) {
        this.physicsDebugRenderer = new THREE.CannonDebugRenderer(this.scene, this.physics.world);
      }

      this.setupEventListeners();
      this.setupTablePlane();
      this.setupLights();
      this.hud = new Hud(this.scene, this.config, this.emitter);

      document.addEventListener("keydown", e => {
        if (e.key === 'w') {
          this.camera.position.z -= 0.1;
        } else if (e.key === 's') {
          this.camera.position.z += 0.1;
        } else if (e.key === 'u') {
          this.camera.position.y += 0.1;
        } else if (e.key === 'j') {
          this.camera.position.y -= 0.1;
        } else if (e.key === '+') {
          this.camera.fov += 1;
        } else if (e.key === '-') {
          this.camera.fov -= 1;
        } else if (e.key === 'ArrowUp') {
          this.camera.rotation.x += 0.05;
        } else if (e.key === 'ArrowDown') {
          this.camera.rotation.x -= 0.05;
        }
        this.camera.updateProjectionMatrix();
        console.log(this.camera.rotation);
        console.log(this.camera.position);
        console.log(this.camera.fov);
      });

      Promise.all([
        this.hud.setup(),
        this.setupPaddles(),
      ]).then(() => {
        requestAnimationFrame(this.animate.bind(this));
        resolve('loaded');
      });
    });
  }

  paddleBallDistance() {
  }

  mousemove(e) {
    let y = this.ball ? this.ball.position.y : 1;
    this.setPaddlePosition(
      Math.max(
        Math.min(
          this.paddle.position.x + 0.001 * e.movementX, this.config.tableWidth),
        -this.config.tableWidth),
      y,
      this.paddle.position.z + 0.001 * e.movementY
    );
    // backup original rotation
    let startRotation = new THREE.Euler().copy(this.camera.rotation);
    
    // final rotation (with lookAt)
    this.camera.lookAt(new THREE.Vector3(this.paddle.position.x, this.config.tableHeight, this.config.tablePositionZ));
    let endRotation = new THREE.Euler().copy(this.camera.rotation);
    
    // revert to original rotation
    this.camera.rotation.copy(startRotation);
    //this.camera.lookAt(this.paddle.position);
    if (this.tween) {
      this.tween.kill();
    }
    this.tween = TweenMax.to(this.camera.rotation, 0.5, {
      x: endRotation.x,
      y: endRotation.y,
      z: endRotation.z,
      ease: Power4.easeOut,
    });
  }

  setupEventListeners() {
    this.emitter.on(EVENT.GAME_OVER, e => {
      this.config.state = STATE.GAME_OVER;
    });
    this.emitter.on(EVENT.BALL_PADDLE_COLLISION, this.ballPaddleCollision.bind(this));
    this.emitter.on(EVENT.BALL_TABLE_COLLISION, this.ballTableCollision.bind(this));
  }

  setupVRControls() {
    // apply VR headset positional data to camera.
    this.controls = new THREE.VRControls(this.camera);
    this.controls.standing = true;
    this.controls.userHeight = this.config.cameraHeight;
    this.setupControllers();
  }

  setupVR() {
    // apply VR stereo rendering to renderer.
    this.effect = new THREE.VREffect(this.renderer);
    this.effect.setSize(window.innerWidth, window.innerHeight);

    // Create a VR manager helper to enter and exit VR mode.
    let params = {
      hideButton: false, // Default: false.
      isUndistorted: false // Default: false.
    };

    this.manager = new WebVRManager(this.renderer, this.effect, params);

    window.addEventListener('resize', this.onResize.bind(this), true);
    window.addEventListener('vrdisplaypresentchange', this.onResize.bind(this), true);
  }

  setupThree() {
    this.renderer = new THREE.WebGLRenderer({antialias: true});
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(this.config.colors.BLUE_BACKGROUND, 1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    document.body.appendChild(this.renderer.domElement);

    // THREE js basics
    this.scene = new THREE.Scene();
    this.scene.scale.y = 0.01;

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 10000);
    // position over the box, will be animated to the final camera position
    this.camera.position.x = 0;
    this.camera.position.z = this.config.tablePositionZ;
    this.camera.position.y = 5;
    this.camera.up.set(-1, 0, 0);
    this.camera.lookAt(new THREE.Vector3(0, this.config.tableHeight, this.config.tablePositionZ));
  }

  setupLights() {
    let light = new THREE.DirectionalLight(0xffffff, 0.3, 0);
    light.position.z = this.config.tablePositionZ;
    light.position.z = 2;
    light.position.y = 4;
    light.shadow.camera.near = 2.5;
    light.shadow.camera.far = 6.2;
    light.shadow.camera.left = -1;
    light.shadow.camera.right = 1;
    // light.shadow.camera.top = 0;
    // light.shadow.camera.bottom = -4;
    light.castShadow = true;
    light.shadow.mapSize.width = (Util.isMobile() ? 1 : 8) * 512;
    light.shadow.mapSize.height = (Util.isMobile() ? 1 : 8) * 512;
    this.scene.add(light);
    //this.scene.add(new THREE.CameraHelper(light.shadow.camera));

    light = new THREE.AmbientLight(0xFFFFFF, 0.9);
    this.scene.add(light);
  }

  setupTablePlane() {
    this.raycaster = new THREE.Raycaster();

    // set opacity to 0 because otherwise it wont be intersected by the raytracer
    // TODO use this instead https://threejs.org/docs/#Reference/Math/Plane
    let geometry = new THREE.PlaneGeometry(this.config.tableWidth * 1.5, this.config.tableDepth, 5, 5);
    let material = new THREE.MeshBasicMaterial({color: 0xffff00, side: THREE.DoubleSide, transparent: true, opacity: 1, wireframe: true});
    this.tablePlane = new THREE.Mesh(geometry, material);
    this.tablePlane.rotation.x = Math.PI / 2;
    this.tablePlane.position.y = this.config.tableHeight + 0.2;
    this.tablePlane.position.z = this.config.tablePositionZ + this.config.tableDepth / 2;
    this.tablePlane.material.visible = true;
    this.scene.add(this.tablePlane);
  }

  setupControllers() {
    navigator.getVRDisplays().then(displays => {
      if (displays) {
        // if we have more than 1 display: ¯\_(ツ)_/¯
        // TODO
        this.display = displays[0];
        if (displays[0].capabilities && displays[0].capabilities.hasPosition) {
          // also check gamepads
          this.controller1 = new THREE.ViveController(0);
          this.controller1.standingMatrix = this.controls.getStandingMatrix();
          this.scene.add(this.controller1);
          this.controller2 = new THREE.ViveController(1);
          this.controller2.standingMatrix = this.controls.getStandingMatrix();
          this.scene.add(this.controller2);

          this.objLoader.load('vr_controller_vive_1_5.obj', object => {

            this.controller = object.children[ 0 ];
            this.controller.material.map = this.textureLoader.load('onepointfive_texture.png');
            this.controller.material.specularMap = this.textureLoader.load('onepointfive_spec.png');

            this.controller1.add(object.clone());
            this.controller2.add(object.clone());
          });
        }
      }
    });

    if (DEBUG_MODE) {
      var material = new THREE.LineBasicMaterial({
        color: 0x00ffff,
      });
      var geometry = new THREE.Geometry();
      geometry.vertices.push(
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, 0)
      );
      this.controllerRay = new THREE.Line(geometry, material);
      this.controllerRay.geometry.dynamic = true;
      this.scene.add(this.controllerRay);
    }
  }

  setupPaddles() {
    return new Promise((resolve, reject) => {
      this.objLoader.load('paddle.obj', object => {
        const scale = 0.024;
        object.scale.set(scale, scale, scale);

        let redMaterial = new THREE.MeshLambertMaterial({
          color: this.config.colors.PADDLE_COLOR,
          side: THREE.DoubleSide,
        });
        let woodMaterial = new THREE.MeshLambertMaterial({
          color: this.config.colors.PADDLE_WOOD_COLOR,
          side: THREE.DoubleSide,
        });
        object.traverse(function(child) {
          if (child instanceof THREE.Mesh) {
            if (child.name === 'Cap_1' || child.name === 'Cap_2' || child.name === 'Extrude') {
              child.material = redMaterial;
            } else {
              child.material = woodMaterial;
            }
            child.castShadow = true;
          }
        });
        this.paddle = object.clone();
        this.paddle.name = 'paddle';
        this.paddle.visible = true;
        this.paddle.castShadow = true;
        this.paddle.position.y = this.config.tableHeight + 0.3;
        this.paddle.position.z = this.config.paddlePositionZ;
        this.scene.add(this.paddle);

        this.paddleOpponent = object.clone();
        this.paddleOpponent.name = 'paddleOpponent';
        this.paddleOpponent.position.z = this.config.tablePositionZ - this.config.tableDepth / 2;
        this.paddleOpponent.position.y = 1;
        this.scene.add(this.paddleOpponent);
        resolve();
      });
    });
  }

  startGame() {
    // prepare the scene
    this.paddle.visible = false;
    this.hud.container.visible = false;
    let table = this.scene.getObjectByName('table');
    if (this.config.mode === MODE.MULTIPLAYER) {
      if (this.communication.isHost) {
        this.renderer.setClearColor(this.config.colors.BLUE_BACKGROUND, 1);
        table.material.color.set(this.config.colors.BLUE_TABLE);
      } else {
        this.renderer.setClearColor(this.config.colors.GREEN_BACKGROUND, 1);
        table.material.color.set(this.config.colors.GREEN_TABLE);
      }
    } else {
      let upwardsTableGroup = this.scene.getObjectByName('upwardsTableGroup');
      upwardsTableGroup.visible = true;
      this.net.visible = false;
      this.physics.net.collisionResponse = 0;
      this.physics.upwardsTable.collisionResponse = 1;
      this.renderer.setClearColor(this.config.colors.PINK_BACKGROUND, 1);
      table.material.color.set(this.config.colors.PINK_TABLE);
    }

    // set colors
    // null object for tweening
    let no = {
      fov: this.camera.fov,
      upX: -1,
      upY: 0,
      scaleY: 0.01,
    };

    let tl = new TimelineMax();
    tl.to('.intro-wrapper', 0.4, {
      autoAlpha: 0,
    }, 0);

    const panDuration = 1;

    tl.to(no, panDuration, {
      fov: 47,
      upX: 0,
      upY: 1,
      scaleY: 1,
      ease: Power3.easeIn,
      onUpdate: () => {
        this.scene.scale.y = no.scaleY;
        this.camera.fov = no.fov;
        this.camera.up.set(no.upX, no.upY, 0);
        this.camera.updateProjectionMatrix();
      },
    }, 1);
    tl.to(this.camera.position, panDuration, {
      x: 0,
      y: 1.6,
      z: 0.6,
      onUpdate: () => {
        this.camera.lookAt(new THREE.Vector3(0, this.config.tableHeight, this.config.tablePositionZ));
      },
      onComplete: () => {
        this.paddle.visible = true;
        this.hud.container.visible = true;

        this.setupVRControls();
        this.hud.message.showMessage();
      }
    }, 1);
    tl.call(() => {
      if (this.config.mode === MODE.SINGLEPLAYER) {
        this.countdown();
      } else {
        this.communication.sendRequestCountdown();
        this.playerRequestedCountdown = true;
        this.requestCountdown();
      }
    }, [], null, '+=1');
  }

  receivedRequestCountdown() {
    this.opponentRequestedCountdown = true;
    this.requestCountdown();
  }

  requestCountdown() {
    if (this.playerRequestedCountdown && this.opponentRequestedCountdown) {
      this.countdown();
    }
  }

  countdown() {
    this.hud.message.hideMessage();
    this.config.state = STATE.COUNTDOWN;
    // countdown from 3, start game afterwards
    this.hud.countdown.showCountdown();
    let n = 2;
    let countdown = this.time.setInterval(() => {
      this.hud.countdown.setCountdown(n);
      n--;
      if (n < 0) {
        this.time.clearInterval(countdown);
        this.hud.countdown.hideCountdown();
        if (this.config.mode === MODE.SINGLEPLAYER) {
          this.addBall();
          this.physics.initBallPosition();
        } else if (this.config.mode === MODE.MULTIPLAYER
            && !this.communication.isHost) {
          let physicsBody = this.addBall();
          this.physics.initBallPosition();
          // if multiplayer, also send the other player a hit so the ball is synced
          this.communication.sendHit({
            x: this.physics.ball.position.x,
            y: this.physics.ball.position.y,
            z: this.physics.ball.position.z,
          }, {
            x: this.physics.ball.velocity.x,
            y: this.physics.ball.velocity.y,
            z: this.physics.ball.velocity.z,
          }, true);
        }
      }
    }, 1000);
  }

  restartGame() {
    // only restart if both players requested it
    if (this.opponentRequestedRestart && this.playerRequestedRestart) {
      this.emitter.emit(EVENT.RESTART_GAME, this.score);
      // TODO reset mode?

      // reset
      this.playerRequestedRestart = false;
      this.opponentRequestedRestart = false;
      this.resetScore();
      this.countdown();
    }
  }

  resetScore() {
    this.score.self = 0;
    this.score.opponent = 0;
    // propagate to HUD
    this.hud.scoreDisplay.setSelfScore(0);
    this.hud.scoreDisplay.setOpponentScore(0);
  }

  setMultiplayer() {
    // prepare multiplayer mode
    this.config.mode = MODE.MULTIPLAYER;
    this.resetTimeoutDuration = 3000;
    this.hud.scoreDisplay.opponentScore.visible = true;
    this.paddleOpponent.visible = true;
    // setup communication channels,
    // add callbacks for received actions
    // TODO throw exception on connection failure
    this.communication.setCallbacks({
      move: this.receivedMove.bind(this),
      hit: this.receivedHit.bind(this),
      miss: this.receivedMiss.bind(this),
      restartGame: this.receivedRestartGame.bind(this),
      requestCountdown: this.receivedRequestCountdown.bind(this),
    });
  }

  setSingleplayer() {
    this.config.mode = MODE.SINGLEPLAYER;
  }

  receivedMove(move) {
    // received a move from the opponent,
    // set his paddle to the position received
    let no = {
      x: this.paddleOpponent.position.x,
      y: this.paddleOpponent.position.y,
      rotationZ: this.paddleOpponent.rotation.z,
    };
    TweenMax.to(no, 0.14, {
      x: move.x,
      y: move.y,
      rotationZ: -move.x,
      onUpdate: () => {
        this.paddleOpponent.position.x = no.x;
        this.paddleOpponent.position.y = no.y;
        this.paddleOpponent.rotation.z = no.rotationZ;
      }
    });
  }

  receivedRestartGame() {
    this.opponentRequestedRestart = true;
    // try to restart game, only does if player also requested restart
    this.restartGame();
  }

  receivedHit(data) {
    // we might not have a ball yet
    this.time.clearTimeout(this.resetBallTimeout);
    if (data.addBall) {
      // this doesnt add a ball if it already exists so were safe to call it
      this.addBall();
    }
    // received vectors are in the other users space
    // invert x and z velocity and mirror the point across the center of the box
    this.physics.ball.position.copy(this.mirrorBallPosition(data.point));
    this.physics.ball.velocity.copy(this.mirrorBallVelocity(data.velocity));
  }

  mirrorBallPosition(pos) {
    let z = pos.z;
    z = z - Math.sign(z - this.config.tablePositionZ) * Math.abs(z - this.config.tablePositionZ) * 2;
    return {
      x: -pos.x, 
      y: pos.y,
      z: z,
    };
  }

  mirrorBallVelocity(vel) {
    return {
      x: -vel.x,
      y: vel.y,
      z: -vel.z,
    };
  }

  receivedMiss(data) {
    this.time.clearTimeout(this.resetBallTimeout);
    // opponent missed, update player score
    // and set game to be over if the score is high enough
    if (data.ballHasHitEnemyTable) {
      this.score.opponent++;
      this.hud.scoreDisplay.setOpponentScore(this.score.opponent);
    } else {
      this.score.self++;
      this.hud.scoreDisplay.setSelfScore(this.score.self);
    }
    if (this.score.self >= this.config.POINTS_FOR_WIN
      || this.score.opponent >= this.config.POINTS_FOR_WIN) {
        this.emitter.emit(EVENT.GAME_OVER, this.score);
    } else {
      // otherwise, the opponent that missed also resets the ball
      // and sends along its new position
      this.receivedHit(data);
    }
  }

  restartPingpongTimeout() {
    // reset the ball position in case the ball is stuck at the net
    // or fallen to the floor
    this.time.clearTimeout(this.resetBallTimeout);
    this.resetBallTimeout = this.time.setTimeout(() => {
      if (this.config.mode === MODE.MULTIPLAYER) {
        if (this.ballHasHitEnemyTable) {
          this.score.self++;
          this.hud.scoreDisplay.setSelfScore(this.score.self);
        } else {
          this.score.opponent++;
          this.hud.scoreDisplay.setOpponentScore(this.score.opponent);
        }
        if (this.score.opponent >= this.config.POINTS_FOR_WIN
            || this.score.self >= this.config.POINTS_FOR_WIN) {
          // game is over
          // TODO maybe wait a little with this so players can enjoy their 11 points
          this.emitter.emit(EVENT.GAME_OVER, this.score);
        } else {
          // the game goes on
          this.physics.initBallPosition();
        }
        this.communication.sendMiss({
          x: this.physics.ball.position.x,
          y: this.physics.ball.position.y,
          z: this.physics.ball.position.z,
        }, {
          x: this.physics.ball.velocity.x,
          y: this.physics.ball.velocity.y,
          z: this.physics.ball.velocity.z,
        }, this.ballHasHitEnemyTable);
      } else {
        this.score.self = 0;
        this.hud.scoreDisplay.setSelfScore(this.score.self);
        this.physics.initBallPosition();
      }
      this.restartPingpongTimeout();
    }, this.resetTimeoutDuration);
  }

  ballIsInBox(ball) {
    // add tolerance to be sure ball wont be reset if the ball is
    // 'inside' of a wall for a short period
    const E = 0.1;
    return ball.position.z - E <= 4
        && ball.position.z + E >= -4;
  }

  ballPaddleCollision(body) {
    // the ball collided with the players paddle
    this.restartPingpongTimeout();
    this.paddleCollisionAnimation();
    this.ballHasHitEnemyTable = false;
    this.sound.hit(body.position);
    if (this.config.mode === MODE.SINGLEPLAYER) {
      this.score.self++;
      this.hud.scoreDisplay.setSelfScore(this.score.self);
      return;
    }
    // mode is multiplayer, send the hit with a small timeout
    // to make sure the collision is done and the ball is not
    // somewhere in the opponents paddle with a weird velocity
    // TODO tweak and test this timeout
    this.time.setTimeout(() => {
      this.communication.sendHit({
        x: body.position.x,
        y: body.position.y,
        z: body.position.z,
      }, {
        x: body.velocity.x,
        y: body.velocity.y,
        z: body.velocity.z,
      });
    }, 10);
  }

  ballTableCollision(point) {
    if (point.z < this.config.tablePositionZ) {
      this.ballHasHitEnemyTable = true;
    }
  }

  paddleCollisionAnimation() {
    // blink the paddle interior
    if (!this.paddle.getObjectByName('paddleHitHighlight')) {
      return;
    }
    this.paddle.getObjectByName('paddleHitHighlight').material.opacity = 1;
    TweenMax.to(this.paddle.getObjectByName('paddleHitHighlight').material, 0.5, {
      opacity: 0,
      ease: Power2.easeOut,
    });
  }

  addBall() {
    this.config.state = STATE.PLAYING;
    if (this.ball) {
      return;
    }
    let ball = new Ball(this.scene, this.config);
    let physicsBall = this.physics.addBall(ball);
    this.ball = ball;
    this.ball.physicsReference = physicsBall;
    this.restartPingpongTimeout();
    return ball.physicsReference;
  }

  setPaddlePosition(x, y, z) {
    this.paddle.rotation.z = -x;
    this.paddle.position.x = x;
    //this.paddle.position.y = Math.max(y, this.config.tableHeight + 0.1);
    this.paddle.position.z = z || this.config.paddlePositionZ;
    this.physics.setPaddlePosition(this.paddle.position.x, this.paddle.position.y, this.paddle.position.z);
  }

  updateControls() {
    if (this.hitTween && this.hitTween.isActive()) {
      return;
    }
    // TODO proper controller managment
    let controller = null;
    if (this.controller1 && this.controller1.visible) {
      controller = this.controller1;
    } else if (this.controller2 && this.controller2.visible) {
      controller = this.controller2;
    }

    // place paddle according to controller
    if (this.display) {
      let intersects = [];
      if (!controller) {
        // if we dont have a controller, intersect the paddlePlane
        // with where the camera is looking and place the paddle there
        this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
        this.raycaster.far = 5;
        intersects = this.raycaster.intersectObject(this.tablePlane, false);
      } else {
        // if we do have a controller, intersect it with where the controller is looking
        let direction = new THREE.Vector3(0, 0, -1);
        direction.applyQuaternion(controller.getWorldQuaternion());
        direction.normalize();
        this.raycaster.set(controller.getWorldPosition(), direction);
        this.raycaster.far = 5;
        intersects = this.raycaster.intersectObject(this.tablePlane, false);
      }
      if (intersects.length > 0) {
        console.log(intersects);
        let point = intersects[0].point;
        this.setPaddlePosition(point.x, point.y, point.z);
      }
    }
  }

  updateBall(ball) {
    ball.position.copy(ball.physicsReference.position);
    ball.quaternion.copy(ball.physicsReference.quaternion);
  }

  ballHitAnimation() {
    if (!this.hitTween || !this.hitTween.isActive() && this.hitAvailable) {
      this.hitTween = new TimelineMax();
      this.hitTween.to(this.paddle.position, 0.05, {
        x: this.ball.position.x,
        y: this.ball.position.y,
        z: this.ball.position.z,
      }).to(this.paddle.position, 0.2, {
        x: this.paddle.position.x,
        y: this.paddle.position.y,
        z: this.paddle.position.z,
      });
      // TweenMax.to(this.paddle.rotation, 0.05, {
      //   x: -0.9,
      //   repeat: 1,
      //   yoyo: true,
      // });
      this.hitAvailable = false;
      this.time.setTimeout(() => {this.hitAvailable = true;}, 300);
    }
  }

  animate(timestamp) {
    let delta = Math.min(timestamp - this.lastRender, 500);
    this.totaltime += delta;

    // TODO proper managment for inactive tabs
    if (!this.tabActive) {
      requestAnimationFrame(this.animate.bind(this));
      return;
    }

    this.updateControls();

    if (this.ball) {
      let dist = new THREE.Vector3();
      dist.subVectors(this.ball.position, this.paddle.position);
      if (dist.length() < 0.3) {
        this.ballHitAnimation();
      } else {
        // this.paddle.position.y = this.config.tableHeight + 0.2;
      }
    }
    if (this.ball && this.config.mode === MODE.MULTIPLAYER && !this.communication.isHost) {
      this.paddle.position.y = Math.max(this.config.tableHeight + 0.1, this.ball.position.y);
      this.paddle.position.x = this.ball.position.x;
    }
    this.physics.setPaddlePosition(this.paddle.position.x, this.paddle.position.y, this.paddle.position.z);

    if (this.config.state === STATE.PLAYING) {
      if (this.config.mode === MODE.MULTIPLAYER) {
        // send where the paddle has moved, if it has moved
        this.communication.sendMove(-this.paddle.position.x, this.paddle.position.y);
      }

      this.physics.step(delta / 1000);
      this.updateBall(this.ball);
      this.physics.predictCollisions(this.physics.ball, this.paddle, this.scene.getObjectByName('net-collider'));
    }

    if (DEBUG_MODE) {
      this.physicsDebugRenderer.update();
    }

    // Update VR headset position and apply to camera.
    if (this.controls) {
      this.controls.update();
    }

    this.time.step();

    // Render the scene through the manager.
    this.lastRender = timestamp;

    this.manager.render(this.scene, this.camera, this.timestamp);
    // this.paddle.rotation.y += 0.01;

    this.frameNumber++;
    requestAnimationFrame(this.animate.bind(this));
  }

  onResize(e) {
    this.effect.setSize(window.innerWidth, window.innerHeight);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }
}
