import '../common/styles/global.css';
import { MotionConfig } from 'framer-motion';
import type { AppProps } from 'next/app';
import Head from 'next/head';
import { Toaster } from 'sonner';

import { DEFAULT_EASE } from '@/common/constants/easings';
import { ModalManager } from '@/modules/modal';

const App = ({ Component, pageProps }: AppProps) => (
  <>
    <Head>
      <title>Collab | Online Whiteboard</title>
      <link rel="icon" href="/favicon.ico" />
    </Head>
    <Toaster position="top-center" richColors />
    <MotionConfig transition={{ ease: DEFAULT_EASE }}>
      <ModalManager />
      <Component {...pageProps} />
    </MotionConfig>
  </>
);

export default App;
