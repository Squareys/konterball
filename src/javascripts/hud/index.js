import TweenMax from 'gsap';
import ScoreDisplay from './score-display';
import Countdown from './countdown';
import Message from './message';
import {MODE, EVENT} from '../constants';

export default class Hud {
  constructor(scene, config, emitter) {
    this.config = config;
    this.emitter = emitter;
    this.scene = scene;
    this.gravity = 0;
    this.ballRadius = 0.03;
    this.ballPaddleBounciness = 1;
    this.ballBoxBounciness = 1;
    this.ballInitVelocity = 1;
    this.paddleModel = 'box';
    this.activateTween = null;

    this.font = null;
    this.container = null;
    this.initialized = false;
    this.modeWasSelected = false;
  }


  setup() {
    return new Promise((resolve, reject) => {
      let fontloader = new THREE.FontLoader();
      fontloader.load('fonts/futura.json', font => {
        this.font = font;
        this.container = new THREE.Group();
        this.container.position.z = 1;
        this.container.position.y = 1.6;
        this.container.rotation.y = Math.PI;
        this.scene.add(this.container);

        this.initialized = true;

        this.message = new Message(this.scene, this.config, this.font);
        this.message.hideMessage();

        this.scoreDisplay = new ScoreDisplay(this.scene, this.config, this.font);
        this.countdown = new Countdown(this.scene, this.config, this.font);
        this.countdown.hideCountdown();
        resolve();
      });
    });
  }
}
