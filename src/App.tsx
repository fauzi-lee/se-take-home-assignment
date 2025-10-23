import { BotIcon, MinusIcon, PlusIcon, TrashIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  className?: string;
  children: React.ReactNode;
}

interface ProgressBarProps {
  value: number; // progress value between 0 and 100
  className?: string;
}

interface Order {
  id: number;
  type: 'vip' | 'normal';
}

interface Robot {
  id: number;
  status: 'idle' | 'processing';
  progress: number;
  order: Order | null;
}

const Button: React.FC<ButtonProps> = ({ children, className, ...props }) => (
  <button
    type="button"
    className={`flex justify-center gap-2 rounded-md px-4 py-2 font-medium ${className ?? ''}`}
    {...props}
  >
    {children}
  </button>
);

const ProgressBar: React.FC<ProgressBarProps> = ({ value, className }) => {
  const safeValue = Math.min(Math.max(value, 0), 100); // clamp between 0–100

  return (
    <div className={`h-1 w-2/3 overflow-hidden rounded-full bg-gray-200 ${className ?? ''}`}>
      <div
        className="h-full bg-neutral-500 transition-all duration-300 ease-in-out"
        style={{ width: `${safeValue}%` }}
      />
    </div>
  );
};

function App() {
  const [pendingOrders, setPendingOrders] = useState<Order[]>([]);
  const [completedOrder, setCompletedOrders] = useState<Order[]>([]);
  const [robots, setRobots] = useState<Robot[]>([
    {
      id: 1,
      status: 'idle',
      progress: 0,
      order: null,
    },
  ]);

  // useRef for id counters (avoids batching double-increment issues)
  const nextOrderIdRef = useRef<number>(1);
  const [nextRobotId, setNextRobotId] = useState(2); // starts from 2 because we seeded 1

  // Track ongoing intervals so we can stop them when bots are removed
  const intervalsRef = useRef<Record<number, ReturnType<typeof setInterval>>>({});
  const timeoutsRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const processingOrderIds = useRef<Set<number>>(new Set());
  const completedOrderIds = useRef<Set<number>>(new Set());

  // --- Add Orders ---
  const addOrder = (type: 'normal' | 'vip') => {
    const id = nextOrderIdRef.current;
    nextOrderIdRef.current += 1;

    const newOrder: Order = { id, type };
    setPendingOrders((prev) => {
      if (type === 'vip') {
        const vipOrders = prev.filter((o) => o.type === 'vip');
        const normalOrders = prev.filter((o) => o.type === 'normal');
        return [...vipOrders, newOrder, ...normalOrders];
      }
      return [...prev, newOrder];
    });
  };

  // --- Add Bot ---
  const addBot = () => {
    setRobots((prev) => [...prev, { id: nextRobotId, status: 'idle', progress: 0, order: null }]);
    setNextRobotId((id) => id + 1);
  };

  // --- Remove Bot ---
  const removeBot = () => {
    setRobots((prev) => {
      if (prev.length === 0) return prev;

      const botToRemove = prev[prev.length - 1];

      // 1️⃣ If bot was processing an order, stop it immediately
      if (botToRemove.status === 'processing' && botToRemove.order) {
        const orderId = botToRemove.order.id;

        // Return order back to pending
        console.log(botToRemove.order, pendingOrders);
        setPendingOrders((orders) => [botToRemove.order!, ...orders]);

        // Remove it from "currently processing" tracking
        processingOrderIds.current.delete(orderId);

        // Also remove any potential completion reservation
        completedOrderIds.current.delete(orderId);

        // Cancel any running timer or interval for this bot
        const runningInterval = intervalsRef.current[botToRemove.id];
        if (runningInterval) {
          clearInterval(runningInterval);
          delete intervalsRef.current[botToRemove.id];
        }

        const runningTimeout = timeoutsRef.current[botToRemove.id];
        if (runningTimeout) {
          clearTimeout(runningTimeout);
          delete timeoutsRef.current[botToRemove.id];
        }
      }

      // 2️⃣ Remove bot from state
      return prev.slice(0, -1);
    });
  };

  // --- Assign Orders to Idle Bots ---
  useEffect(() => {
    const idleBots = robots.filter((r) => r.status === 'idle');
    if (idleBots.length === 0 || pendingOrders.length === 0) return;

    const updatedBots = [...robots];
    const updatedPending = [...pendingOrders];

    idleBots.forEach((bot) => {
      const nextOrderIndex = updatedPending.findIndex((o) => !processingOrderIds.current.has(o.id));
      if (nextOrderIndex === -1) return;

      const nextOrder = updatedPending[nextOrderIndex];
      processingOrderIds.current.add(nextOrder.id);
      updatedPending.splice(nextOrderIndex, 1);

      processOrder(bot.id, nextOrder);

      const index = updatedBots.findIndex((r) => r.id === bot.id);
      updatedBots[index] = {
        ...bot,
        status: 'processing',
        progress: 0,
        order: nextOrder,
      };
    });

    setRobots(updatedBots);
    setPendingOrders(updatedPending);
  }, [robots, pendingOrders]);

  // --- Process Order Function ---
  const processOrder = (botId: number, order: Order) => {
    // Prevent starting if already being processed
    if (completedOrderIds.current.has(order.id)) return;

    if (!processingOrderIds.current.has(order.id)) {
      processingOrderIds.current.add(order.id);
    }

    // If already completed or not reserved, stop early
    if (completedOrderIds.current.has(order.id) || !processingOrderIds.current.has(order.id)) {
      return;
    }

    const duration = 10000; // 10s
    const step = 100;
    const increment = 100 / (duration / step);
    let progress = 0;

    // Ensure no duplicate processing by clearing any existing interval
    if (intervalsRef.current[botId]) {
      clearInterval(intervalsRef.current[botId]);
      delete intervalsRef.current[botId];
    }

    const interval = setInterval(() => {
      progress += increment;
      setRobots((prev) =>
        prev.map((r) => (r.id === botId ? { ...r, progress: Math.min(progress, 100) } : r))
      );
    }, step);

    intervalsRef.current[botId] = interval;

    const t = setTimeout(() => {
      // Guard again to prevent duplicates or if bot/order was cancelled
      if (completedOrderIds.current.has(order.id) || !processingOrderIds.current.has(order.id)) {
        clearInterval(interval);
        delete intervalsRef.current[botId];
        clearTimeout(t);
        return;
      }

      // Mark completed (set before setState)
      completedOrderIds.current.add(order.id);

      clearInterval(interval);
      delete intervalsRef.current[botId];

      setCompletedOrders((prev) => {
        if (prev.some((o) => o.id === order.id)) return prev;
        return [...prev, order];
      });

      processingOrderIds.current.delete(order.id);

      setRobots((prev) =>
        prev.map((r) => (r.id === botId ? { ...r, status: 'idle', progress: 0, order: null } : r))
      );

      // Remove from pending only once
      setPendingOrders((prev) => prev.filter((o) => o.id !== order.id));
      processingOrderIds.current.delete(order.id);
      clearTimeout(t);
    }, duration);

    timeoutsRef.current[botId] = t; // 👈 track this timeout
  };

  const formatOrderId = (id: number): string => id.toString().padStart(4, '0');

  return (
    <div className="flex h-screen w-screen gap-4 bg-neutral-800 p-20">
      <div className="flex w-3/4 flex-col gap-4 rounded-lg">
        <div className="flex h-1/3 w-full flex-col gap-4 rounded-lg bg-neutral-900 p-8">
          <div className="text-semibold text-xl">Robots</div>

          <div className="scrollbar flex h-full w-[99%] gap-2 overflow-x-auto">
            {robots.map((robot) => (
              <div
                key={robot.id}
                className="flex w-40 flex-none flex-col items-center justify-center gap-2 rounded-lg border border-neutral-400 p-4 text-neutral-400"
              >
                <BotIcon className="h-1/2 w-1/2" />
                {robot.status === 'idle' ? 'Idle' : <ProgressBar value={robot.progress} />}
                {robot.order && (
                  <div className="mt-1 text-xs text-neutral-300">
                    {formatOrderId(robot.order.id)} {robot.order.type === 'vip' ? '(VIP)' : ''}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="flex h-2/3 w-full gap-4">
          <div className="flex w-1/2 flex-col gap-4 rounded-lg bg-neutral-900 p-8">
            <div className="text-semibold text-xl">Pending</div>
            <div className="scrollbar flex h-[99%] flex-col gap-2 overflow-y-auto">
              {pendingOrders.map((order) => (
                <div
                  key={order.id}
                  className={`rounded-lg border border-neutral-400 p-4 text-center ${
                    processingOrderIds.current.has(order.id) ? 'opacity-80' : ''
                  }`}
                >
                  {formatOrderId(order.id)} {order.type === 'vip' ? '(VIP)' : ''}
                </div>
              ))}
            </div>
          </div>
          <div className="flex w-1/2 flex-col gap-4 rounded-lg bg-neutral-900 p-8">
            <div className="text-semibold text-xl">Complete</div>
            <div className="scrollbar flex h-[99%] flex-col gap-2 overflow-y-auto">
              {completedOrder.map((order) => (
                <div
                  key={order.id}
                  className="rounded-lg border border-neutral-400 p-4 text-center"
                >
                  {formatOrderId(order.id)} {order.type === 'vip' ? '(VIP)' : ''}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="flex w-1/4 flex-col gap-4 rounded-lg bg-neutral-900 p-8">
        <div className="text-semibold text-xl">Actions</div>
        <Button onClick={() => addOrder('normal')}>New Normal Order</Button>
        <Button onClick={() => addOrder('vip')}>New VIP Order</Button>
        <Button onClick={addBot}>
          <PlusIcon /> Add Bot
        </Button>
        <Button onClick={removeBot}>
          <MinusIcon /> Remove Bot
        </Button>
        <Button onClick={() => setCompletedOrders([])}>
          <TrashIcon /> Clear Completed Orders
        </Button>
      </div>
    </div>
  );
}

export default App;
