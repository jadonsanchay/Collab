import { useRoom } from '@/common/recoil/room';

const UserList = () => {
  const { users } = useRoom();

  return (
    <div className="pointer-events-none absolute z-30 flex p-5">
      {[...users.keys()].map((userId, index) => (
        <div
          key={userId}
          className="flex size-5 select-none items-center justify-center rounded-full text-xs text-white md:size-8 md:text-base lg:size-12"
          style={{
            backgroundColor: users.get(userId)?.color || 'black',
            marginLeft: index !== 0 ? '-0.5rem' : 0,
            // Dimmed while their socket is gone but their place is still held.
            opacity: users.get(userId)?.offline ? 0.4 : 1,
          }}
          title={
            users.get(userId)?.offline
              ? `${users.get(userId)?.name} (reconnecting)`
              : users.get(userId)?.name
          }
        >
          {users.get(userId)?.name.split('')[0] || 'A'}
        </div>
      ))}
    </div>
  );
};

export default UserList;
