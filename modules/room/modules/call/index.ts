import dynamic from 'next/dynamic';

/**
 * Loaded only when rendered, which only happens when the server's
 * `features.rtc` is true: the media SDK is a separate chunk that a
 * deployment without calls never sends.
 */
const CallEntry = dynamic(() => import('./components/CallEntry'), { ssr: false });

export default CallEntry;
