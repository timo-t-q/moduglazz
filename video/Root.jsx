import React from 'react';
import { Composition } from 'remotion';
import { Promo } from './Promo.jsx';

export const Root = () => (
  <>
    <Composition id="PromoVertical" component={Promo} durationInFrames={210} fps={30} width={1080} height={1920} defaultProps={{ lang: 'en' }} />
    <Composition id="PromoWide" component={Promo} durationInFrames={210} fps={30} width={1920} height={1080} defaultProps={{ lang: 'en' }} />
  </>
);
