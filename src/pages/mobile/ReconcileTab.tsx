import { useState, useEffect, useCallback } from 'react';
import { Button, Form, Input, TextArea, Selector, Toast, Tag, Collapse } from 'antd-mobile';
import { useAuth } from '../../hooks/useAuth';
import { supabase, type Account, type Reconciliation, type AccountBalance, ACCOUNT_TYPES } from '../../lib/supabase';
import dayjs from 'dayjs';

export default function ReconcileTab() {
  const { user } = useAuth();
  const [balances, setBalances] = useState<AccountBalance[]>([]);
  const [reconciliations, setReconciliations] = useState<(Reconciliation & { account_name?: string })[]>([]);
  const [loading, setLoading] = useState(false);

  // 选中某个账户后填入实际余额
  const [selectedAccount, setSelectedAccount] = useState<AccountBalance | null>(null);
  const [actualBalance, setActualBalance] = useState('');
  const [recNotes, setRecNotes] = useState('');

  const loadData = useCallback(async () => {
    if (!user) return;

    // 加载账户余额（通过视图或 SQL 查询）
    const { data: accData } = await supabase
      .from('accounts')
      .select('*')
      .eq('user_id', user.id);

    if (accData) {
      // 依次计算每个账户的余额
      const balancesWithCalc = await Promise.all(accData.map(async (acc: Account) => {
        // 收入
        const { data: income } = await supabase
          .from('transactions')
          .select('amount')
          .eq('to_account_id', acc.id)
          .eq('is_deleted', false);
        const totalIncome = income?.reduce((sum, t) => sum + (Number(t.amount) || 0), 0) || 0;

        // 支出
        const { data: expense } = await supabase
          .from('transactions')
          .select('amount')
          .eq('from_account_id', acc.id)
          .eq('is_deleted', false);
        const totalExpense = expense?.reduce((sum, t) => sum + (Number(t.amount) || 0), 0) || 0;

        // 换汇入账
        const { data: exIn } = await supabase
          .from('transactions')
          .select('to_amount')
          .eq('to_account_id', acc.id)
          .eq('type', 'exchange')
          .eq('is_deleted', false);
        const totalExIn = exIn?.reduce((sum, t) => sum + (Number(t.to_amount) || 0), 0) || 0;

        // 换汇出账
        const { data: exOut } = await supabase
          .from('transactions')
          .select('from_amount')
          .eq('from_account_id', acc.id)
          .eq('type', 'exchange')
          .eq('is_deleted', false);
        const totalExOut = exOut?.reduce((sum, t) => sum + (Number(t.from_amount) || 0), 0) || 0;

        const currentBalance = (Number(acc.initial_balance) || 0) + totalIncome - totalExpense + totalExIn - totalExOut;

        return {
          account_id: acc.id,
          user_id: acc.user_id,
          account_type: acc.account_type,
          name: acc.name,
          currency: acc.currency,
          initial_balance: Number(acc.initial_balance) || 0,
          current_balance: currentBalance,
        };
      }));
      setBalances(balancesWithCalc);
    }

    // 加载对账历史
    const { data: recData } = await supabase
      .from('reconciliations')
      .select('*, accounts(name)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(30);

    if (recData) {
      setReconciliations(
        recData.map((r: any) => ({ ...r, account_name: r.accounts?.name }))
      );
    }
  }, [user]);

  useEffect(() => { loadData(); }, [loadData]);

  // 提交对账
  const handleSubmit = async () => {
    if (!user || !selectedAccount || !actualBalance) {
      Toast.show({ icon: 'fail', content: '请填写实际余额' });
      return;
    }

    setLoading(true);
    const sysBal = selectedAccount.current_balance;
    const actBal = parseFloat(actualBalance);
    const diff = actBal - sysBal;

    const { error } = await supabase.from('reconciliations').insert({
      user_id: user.id,
      account_id: selectedAccount.account_id,
      reconcile_date: dayjs().format('YYYY-MM-DD'),
      system_balance: sysBal,
      actual_balance: actBal,
      notes: recNotes || null,
      submitted_by: user.id,
      status: diff === 0 ? 'matched' : 'mismatch',
    });

    setLoading(false);
    if (error) {
      Toast.show({ icon: 'fail', content: '提交失败' });
    } else {
      Toast.show({
        icon: diff === 0 ? 'success' : 'fail',
        content: diff === 0 ? '余额一致 ✅' : `差异: ${diff > 0 ? '+' : ''}${diff.toFixed(2)} ⚠️`,
        duration: 3000,
      });
      setSelectedAccount(null);
      setActualBalance('');
      setRecNotes('');
      loadData();
    }
  };

  // 获取某个账户最近的对账状态
  const getLastReconciliation = (accountId: string) => {
    return reconciliations.find(r => r.account_id === accountId);
  };

  return (
    <div style={{ padding: 16, paddingBottom: 70 }}>
      <h3 style={{ margin: '0 0 16px' }}>📊 对账 — 上报账户余额</h3>
      <p style={{ color: '#666', fontSize: 13, marginBottom: 16 }}>
        打开你的银行App或钱包，确认每个账户的实际余额，然后填入下方。
        系统会自动和流水计算出的余额做对比。
      </p>

      {/* 账户列表 — 每个人看到自己的账户和系统余额 */}
      {balances.map(bal => {
        const lastRec = getLastReconciliation(bal.account_id);
        const isMatched = lastRec?.status === 'matched';
        const icon = ACCOUNT_TYPES.find(t => t.value === bal.account_type)?.icon || '💳';

        return (
          <div key={bal.account_id} style={{
            background: '#fff', borderRadius: 12, padding: 16, marginBottom: 12,
            boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
            borderLeft: lastRec?.status === 'mismatch' ? '3px solid #ff4d4f' : '3px solid transparent',
          }}>
            {/* 选择此账户对账，还是直接展示提交区域 */}
            {selectedAccount?.account_id === bal.account_id ? (
              // 展开：填写实际余额
              <div>
                <div style={{ fontWeight: 600, marginBottom: 12 }}>
                  {icon} {bal.name}
                  <Tag style={{ marginLeft: 8 }}>{bal.currency}</Tag>
                </div>
                <div style={{
                  background: '#f0f5ff', borderRadius: 8, padding: '8px 12px', marginBottom: 12,
                  display: 'flex', justifyContent: 'space-between',
                }}>
                  <span>系统余额</span>
                  <span style={{ fontWeight: 600, fontSize: 18 }}>{bal.current_balance.toLocaleString()}</span>
                </div>
                <Form.Item label="我的实际余额">
                  <Input
                    placeholder="填入你看到的实际余额"
                    type="number"
                    value={actualBalance}
                    onChange={setActualBalance}
                    style={{ fontSize: 18, fontWeight: 600 }}
                  />
                </Form.Item>
                <Form.Item label="备注（选填）">
                  <TextArea
                    placeholder="如有差异，说明原因"
                    value={recNotes}
                    onChange={setRecNotes}
                    rows={2}
                  />
                </Form.Item>
                {actualBalance && (
                  <div style={{
                    background: parseFloat(actualBalance) === bal.current_balance ? '#f6ffed' : '#fff2f0',
                    borderRadius: 8, padding: '8px 12px', marginBottom: 12,
                    color: parseFloat(actualBalance) === bal.current_balance ? '#52c41a' : '#ff4d4f',
                  }}>
                    差异: {parseFloat(actualBalance) === bal.current_balance ? '0 (一致)' :
                      `${parseFloat(actualBalance) > bal.current_balance ? '+' : ''}${(parseFloat(actualBalance) - bal.current_balance).toFixed(2)}`}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button
                    block color="primary" loading={loading}
                    onClick={handleSubmit} style={{ borderRadius: 8 }}
                  >
                    提交对账
                  </Button>
                  <Button
                    fill="none" onClick={() => { setSelectedAccount(null); setActualBalance(''); setRecNotes(''); }}
                  >
                    取消
                  </Button>
                </div>
              </div>
            ) : (
              // 折叠：显示摘要，点击展开
              <div onClick={() => setSelectedAccount(bal)} style={{ cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ fontWeight: 600 }}>{icon} {bal.name}</span>
                    <Tag style={{ marginLeft: 8 }}>{bal.currency}</Tag>
                  </div>
                  <span style={{ fontSize: 16, fontWeight: 600 }}>
                    {bal.current_balance.toLocaleString()}
                  </span>
                </div>
                {lastRec ? (
                  <div style={{ marginTop: 8, fontSize: 12, color: isMatched ? '#52c41a' : '#ff4d4f' }}>
                    {isMatched ? '✅' : '⚠️'} 上次对账: {lastRec.reconcile_date}
                    {!isMatched && ` 差异${lastRec.difference > 0 ? '+' : ''}${lastRec.difference?.toFixed(2)}`}
                  </div>
                ) : (
                  <div style={{ marginTop: 8, fontSize: 12, color: '#999' }}>尚未对账 — 点击上报余额</div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {balances.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>
          还没有账户，请先在记账Tab中添加账户
        </div>
      )}

      {/* 对账历史 */}
      {reconciliations.length > 0 && (
        <Collapse defaultActiveKey={[]} style={{ marginTop: 16 }}>
          <Collapse.Panel key="history" title={`📋 对账历史 (${reconciliations.length}条)`}>
            {reconciliations.slice(0, 20).map(r => (
              <div key={r.id} style={{
                padding: '8px 0', borderBottom: '1px solid #f0f0f0', fontSize: 13,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>
                    {r.account_name || '账户'} | {r.reconcile_date}
                  </span>
                  <span style={{ color: r.status === 'matched' ? '#52c41a' : '#ff4d4f' }}>
                    {r.status === 'matched' ? '✅ 匹配' : '⚠️ 差异'}
                    {r.status !== 'matched' && ` ${r.difference > 0 ? '+' : ''}${r.difference?.toFixed(2)}`}
                  </span>
                </div>
              </div>
            ))}
          </Collapse.Panel>
        </Collapse>
      )}
    </div>
  );
}
