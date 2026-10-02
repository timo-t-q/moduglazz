import { Config } from '@remotion/cli/config';

// WebGL needs a real GPU path in headless Chrome
Config.setChromiumOpenGlRenderer('angle');
Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(92);
