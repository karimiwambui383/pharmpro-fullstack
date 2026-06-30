// ════════════════════════════════════════════════════════════
// apps/web/src/pages/dashboard/DashboardPage.tsx
// ════════════════════════════════════════════════════════════
import { useNavigate }         from 'react-router-dom'
import {
  DollarSign, Pill, Clock, AlertTriangle,
  ShoppingCart, UserPlus, Package, TrendingUp,
  Activity,
}                              from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
}                              from 'recharts'
import { format }              from 'date-fns'
import { useSalesStats, useRevenueTrend } from '../../api/sales.api'
import { useQueueStats }       from '../../api/prescriptions.api'
import { useInventoryStats }   from '../../api/inventory.api'
import { KpiCard }             from '../../components/ui/KpiCard'
import { Card, CardHeader }    from '../../components/ui/Card'
import { Badge }               from '../../components/ui/Badge'
import { Button }              from '../../components/ui/Button'
import { useUiStore }          from '../../store/ui.store'

// Custom tooltip for chart
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="glass-card px-3 py-2 text-xs">
      <p className="text-text3 mb-1">{label}</p>
      <p className="text-blue font-bold">
        KES {Number(payload[0]?.value ?? 0).toLocaleString('en-KE')}
      </p>
    </div>
  )
}

export default function DashboardPage() {
  const navigate       = useNavigate()
  const openModal      = useUiStore(s => s.openModal)
  const { data: sales, isLoading: salesLoading }  = useSalesStats()
  const { data: queue, isLoading: queueLoading }  = useQueueStats()
  const { data: inv,   isLoading: invLoading   }  = useInventoryStats()
  const { data: trend }                            = useRevenueTrend(7)

  // Format trend data for recharts
  const chartData = (trend ?? []).map((d: any) => ({
    date:    format(new Date(d.date), 'd MMM'),
    revenue: Number(d.revenue),
  }))

  return (
    <div className="space-y-5 page-enter">

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Today's revenue"
          value={`KES ${(sales?.today?.revenue ?? 0).toLocaleString('en-KE')}`}
          change="↑ 12.4%"
          trend="up"
          icon={<DollarSign size={20}/>}
          color="blue"
          loading={salesLoading}
        />
        <KpiCard
          label="Prescriptions filled"
          value={sales?.today?.count ?? 0}
          change="↑ 8%"
          trend="up"
          icon={<Pill size={20}/>}
          color="green"
          loading={salesLoading}
        />
        <KpiCard
          label="Rx queue"
          value={queue?.total ?? 0}
          change={queue?.urgent ? `${queue.urgent} urgent` : undefined}
          trend="warn"
          icon={<Clock size={20}/>}
          color="amber"
          loading={queueLoading}
        />
        <KpiCard
          label="Low stock alerts"
          value={inv?.lowStock ?? 0}
          change={inv?.expiring ? `${inv.expiring} expiring` : undefined}
          trend="down"
          icon={<AlertTriangle size={20}/>}
          color="red"
          loading={invLoading}
        />
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label:'New Sale',          icon:<ShoppingCart size={22}/>, color:'bg-blue-lt text-blue',   route:'/pos' },
          { label:'New Prescription',  icon:<Pill size={22}/>,         color:'bg-purple-lt text-purple',modal:'newRx' },
          { label:'Register Patient',  icon:<UserPlus size={22}/>,     color:'bg-teal-lt text-teal',   modal:'newPatient' },
          { label:'Receive Stock',     icon:<Package size={22}/>,      color:'bg-amber-lt text-amber', modal:'receiveStock' },
        ].map(qa => (
          <button
            key={qa.label}
            onClick={() => qa.route ? navigate(qa.route) : openModal(qa.modal!)}
            className="glass-card p-4 text-center hover:-translate-y-1 transition-all
                       hover:shadow-lg cursor-pointer group"
          >
            <div className={`w-12 h-12 rounded-2xl ${qa.color} flex items-center
                            justify-center mx-auto mb-2.5 transition-transform
                            group-hover:scale-110`}>
              {qa.icon}
            </div>
            <p className="text-xs font-bold text-text2">{qa.label}</p>
          </button>
        ))}
      </div>

      {/* Revenue chart + Queue */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Chart — wider */}
        <div className="lg:col-span-3">
          <Card>
            <CardHeader
              title="Revenue — last 7 days"
              icon={<TrendingUp size={16}/>}
              action={
                <Button variant="ghost" size="xs" onClick={() => navigate('/finance')}>
                  View finance
                </Button>
              }
            />
            <div className="flex gap-6 mb-4">
              {[
                { label:'Revenue',  value:`KES ${(sales?.today?.revenue ?? 0).toLocaleString('en-KE')}` },
                { label:'Avg order',value:`KES ${(sales?.today?.avgOrder ?? 0).toLocaleString('en-KE')}` },
                { label:'Txns',     value: sales?.today?.count ?? 0 },
              ].map(s => (
                <div key={s.label}>
                  <p className="text-xs text-text3 uppercase tracking-wide font-bold">{s.label}</p>
                  <p className="text-lg font-extrabold text-text mt-0.5">{s.value}</p>
                </div>
              ))}
            </div>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={chartData}>
                <CartesianGrid stroke="rgba(255,255,255,.04)" strokeDasharray="4 4" />
                <XAxis dataKey="date" tick={{ fill:'#4a5878', fontSize:11 }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fill:'#4a5878', fontSize:11 }}
                  axisLine={false} tickLine={false}
                  tickFormatter={v => `${(v/1000).toFixed(0)}K`}
                />
                <Tooltip content={<ChartTooltip />} />
                <Line
                  type="monotone" dataKey="revenue"
                  stroke="#3b82f6" strokeWidth={2.5}
                  dot={{ fill:'#3b82f6', r:4 }}
                  activeDot={{ r:6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </Card>
        </div>

        {/* Rx queue — narrower */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader
              title="Prescription queue"
              icon={<Clock size={16}/>}
              action={
                <Badge variant={queue?.urgent ? 'danger' : 'info'}>
                  {queue?.total ?? 0} pending
                </Badge>
              }
            />
            <div className="space-y-2">
              {queueLoading
                ? Array.from({length:3}).map((_,i) => (
                    <div key={i} className="shimmer h-16 rounded-lg" />
                  ))
                : (queue?.total ?? 0) === 0
                ? <p className="text-center text-text3 text-sm py-8">Queue is clear ✓</p>
                : [
                    { name:'Ahmed Khalid',  drug:'Insulin Glargine × 3',   status:'urgent',     time:'8 min' },
                    { name:'Mary Wanjiku',  drug:'Metformin 850mg × 60',    status:'processing', time:'22 min' },
                    { name:'Fatuma Ali',    drug:'Amoxicillin 500mg × 21',  status:'ready',      time:'41 min' },
                  ].map((rx, i) => (
                    <div
                      key={i}
                      onClick={() => navigate('/prescriptions')}
                      className="flex items-center gap-3 p-3 rounded-lg bg-surface
                                 border border-border hover:border-border cursor-pointer
                                 transition-all hover:bg-bg4 group"
                    >
                      <div className={`w-1 self-stretch rounded-full flex-shrink-0 ${
                        rx.status === 'urgent'     ? 'bg-red'   :
                        rx.status === 'processing' ? 'bg-blue'  : 'bg-green'
                      }`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-text truncate">{rx.name}</p>
                        <p className="text-xs text-text2 truncate">{rx.drug}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant={
                            rx.status==='urgent'?'danger':rx.status==='ready'?'success':'info'
                          }>
                            {rx.status}
                          </Badge>
                          <span className="text-xs text-text3">{rx.time} ago</span>
                        </div>
                      </div>
                    </div>
                  ))
              }
            </div>
            <Button
              variant="ghost" size="sm"
              className="w-full mt-3 justify-center"
              onClick={() => navigate('/prescriptions')}
            >
              View all prescriptions
            </Button>
          </Card>
        </div>
      </div>

      {/* Alerts + Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader
            title="Critical alerts"
            icon={<AlertTriangle size={16}/>}
            action={
              <Button variant="ghost" size="xs" onClick={() => navigate('/inventory')}>
                View inventory
              </Button>
            }
          />
          <div className="space-y-2">
            {[
              { type:'danger',  msg:'Amoxicillin 500mg — 12 units left (reorder: 50)' },
              { type:'warning', msg:'Metronidazole Batch MET-09 — expires in 18 days' },
              { type:'info',    msg:'PO-2024-092 expected today from Medisel Distributors' },
            ].map((a, i) => (
              <div
                key={i}
                className={`flex items-start gap-2.5 p-3 rounded-lg border text-xs
                  ${a.type==='danger'  ? 'bg-red-lt    border-red/30    text-red'   :
                    a.type==='warning' ? 'bg-amber-lt  border-amber/30  text-amber' :
                                         'bg-blue-lt   border-blue/30   text-blue'  }`}
              >
                <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                <span>{a.msg}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="Recent activity" icon={<Activity size={16}/>} />
          <div className="space-y-3">
            {[
              { dot:'g', text:'Sale #4521 — KES 1,240 (Cash)',            sub:'2 min ago · Ben Mutua'    },
              { dot:'b', text:'RX-7812 verified & dispensed',             sub:'8 min ago · Dr. Priya Kato' },
              { dot:'a', text:'Low stock: Salbutamol 100mcg (8 left)',     sub:'22 min ago · System'      },
              { dot:'b', text:'New patient: John Kariuki registered',      sub:'38 min ago · Reception'   },
              { dot:'g', text:'PO-2024-090 received — 48 items',           sub:'1 hr ago · Store'         },
            ].map((item, i) => (
              <div key={i} className="flex gap-3">
                <div className="relative flex-shrink-0 mt-1.5">
                  {i < 4 && (
                    <div className="absolute top-3 left-[5px] w-px h-full bg-border" />
                  )}
                  <div className={`w-2.5 h-2.5 rounded-full border-2 border-bg3 ${
                    item.dot==='g'?'bg-green':item.dot==='a'?'bg-amber':'bg-blue'
                  }`} />
                </div>
                <div>
                  <p className="text-xs font-semibold text-text">{item.text}</p>
                  <p className="text-xs text-text3 mt-0.5">{item.sub}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}