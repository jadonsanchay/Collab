import { getMyUserId } from '@/common/lib/identity';
import { useRoom } from '@/common/store/room.store';

import UserMouse from './UserMouse';

const MousesRenderer = () => {
  const { users } = useRoom();

  return (
    <>
      {[...users.keys()].map((userId) => {
        if (userId === getMyUserId()) return null;
        return <UserMouse userId={userId} key={userId} />;
      })}
    </>
  );
};

export default MousesRenderer;
