import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Button, Form, Input, TextArea, Selector, DatePicker,
  ImageUploader, Collapse, Tag, Toast, Popup, Dialog,
} from 'antd-mobile';
import { AddOutline, DeleteOutline } from 'antd-mobile-icons';
import { useAuth } from '../../hooks/useAuth';
import {
  supabase, type Account, type Transaction,
  ACCOUNT_TYPES, CURRENCIES, TRANSFER_DIRECTIONS,
} from '../../lib/supabase';
import dayjs from 'dayjs';

// 记录类型
const RECORD_TYPES = [
  { label: '💸 付款', value: 'expense' },
  { label: '💰 收款', value: 'income' },
  { label: '🔄 换汇', value: 'exchange' },
  { label: '📤 转款', value: 'transfer' },
];

const DIRECTIONS = [
  { label: '国内', value: 'domestic' },
  { label: '国外', value: 'international' },
];

export default function RecordTab() {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [dateRecords, setDateRecords] = useState<Transaction[]>([]);
  const submittingRef = useRef(false);
  const [showForm, setShowForm] = useState(false);
  const [formType, setFormType] = useState<string>('expense');
  const [loading, setLoading] = useState(false);

  // 表单字段
  const [direction, setDirection] = useState<string>('');
  const [currency, setCurrency] = useState<string>('');
  const [amount, setAmount] = useState('');
  const [fromCurrency, setFromCurrency] = useState('');
  const [toCurrency, setToCurrency] = useState('');
  const [fromAmount, setFromAmount] = useState('');
  const [toAmount, setToAmount] = useState('');
  const [exchangeRate, setExchangeRate] = useState('');
  const [fromAccountId, setFromAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [notes, setNotes] = useState('');
  const [txDate, setTxDate] = useState<Date>(new Date());
  const [imageFile, setImageFile] = useState<File | null>(null);

  // 账户管理
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [newAccountType, setNewAccountType] = useState('');
  const [newAccountName, setNewAccountName] = useState('');
  const [newAccountCurrency, setNewAccountCurrency] = useState('');
  const [newAccountInitBalance, setNewAccountInitBalance] = useState('');

  // 加载数据
  const loadData = useCallback(async () => {
    if (!user) return;
    const targetDate = dayjs(txDate).format('YYYY-MM-DD');

    const [accRes, txRes] = await Promise.all([
      supabase.from('accounts').select('*').eq('user_id', user.id),
      supabase.from('transactions').select('*')
        .eq('user_id', user.id)
        .eq('transaction_date', targetDate)
        .eq('is_deleted', false)
        .order('created_at', { ascending: false }),
    ]);
    if (accRes.data) setAccounts(accRes.data);
    if (txRes.data) setDateRecords(txRes.data);
  }, [user, txDate]);

  useEffect(() => { loadData(); }, [loadData]);

  // 删除记录（软删除）
  const handleDeleteRecord = async (id: string) => {
    const confirmed = await new Promise<boolean>((resolve) => {
      Dialog.confirm({
        title: '确认删除',
        content: '确定要删除这条记录吗？',
        onConfirm: () => { resolve(true); },
        onCancel: () => { resolve(false); },
      });
    });
    if (!confirmed) return;
    const { error } = await supabase.from('transactions').update({ is_deleted: true })
      .eq('id', id);
    if (error) {
      Toast.show({ icon: 'fail', content: '删除失败' });
    } else {
      Toast.show({ icon: 'success', content: '已删除' });
      loadData();
    }
  };

  // 上传凭证图片
  const uploadReceipt = async (file: File): Promise<string | null> => {
    const ext = file.name.split('.').pop();
    const path = `${user!.id}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage.from('receipts').upload(path, file);
    if (error) {
      Toast.show({ icon: 'fail', content: '图片上传失败' });
      return null;
    }
    const { data: urlData } = supabase.storage.from('receipts').getPublicUrl(path);
    return urlData.publicUrl;
  };

  // 提交记录
  const handleSubmit = async () => {
    if (!user) return;
    if (submittingRef.current) return; // 防重复提交锁
    submittingRef.current = true;
    setLoading(true);

    try {
      let imageUrl = '';
      if (imageFile) {
        const url = await uploadReceipt(imageFile);
        if (url) imageUrl = url;
      }

      const base = {
        user_id: user.id,
        transaction_date: dayjs(txDate).format('YYYY-MM-DD'),
        notes: notes || null,
        image_url: imageUrl || null,
      };

      let data: any = {};
      switch (formType) {
        case 'expense':
          if (!direction || !currency || !amount || !fromAccountId) {
            Toast.show({ icon: 'fail', content: '请填写完整信息' });
            return;
          }
          data = { ...base, type: 'expense', direction, currency, amount: parseFloat(amount), from_account_id: fromAccountId };
          break;
        case 'income':
          if (!direction || !currency || !amount || !toAccountId) {
            Toast.show({ icon: 'fail', content: '请填写完整信息' });
            return;
          }
          data = { ...base, type: 'income', direction, currency, amount: parseFloat(amount), to_account_id: toAccountId };
          break;
        case 'exchange':
          if (!fromCurrency || !toCurrency || !fromAmount || !toAmount || !exchangeRate || !fromAccountId || !toAccountId) {
            Toast.show({ icon: 'fail', content: '请填写完整信息' });
            return;
          }
          data = {
            ...base, type: 'exchange',
            from_currency: fromCurrency, to_currency: toCurrency,
            from_amount: parseFloat(fromAmount), to_amount: parseFloat(toAmount),
            exchange_rate: parseFloat(exchangeRate),
            from_account_id: fromAccountId, to_account_id: toAccountId,
          };
          break;
        case 'transfer': {
          const fromAcc = myAccounts.find(a => a.id === fromAccountId);
          const toAcc = myAccounts.find(a => a.id === toAccountId);
          const isCross = fromAcc && toAcc && fromAcc.currency !== toAcc.currency;
          if (!direction || !fromAccountId || !toAccountId) {
            Toast.show({ icon: 'fail', content: '请填写完整信息' });
            return;
          }
          if (isCross) {
            if (!fromAmount || !toAmount || !exchangeRate) {
              Toast.show({ icon: 'fail', content: '请填写完整信息' });
              return;
            }
            data = {
              ...base, type: 'transfer', direction,
              from_currency: fromAcc.currency, to_currency: toAcc.currency,
              from_amount: parseFloat(fromAmount), to_amount: parseFloat(toAmount),
              exchange_rate: parseFloat(exchangeRate),
              from_account_id: fromAccountId, to_account_id: toAccountId,
            };
          } else {
            if (!amount) {
              Toast.show({ icon: 'fail', content: '请填写金额' });
              return;
            }
            data = {
              ...base, type: 'transfer', direction,
              currency: fromAcc?.currency || '',
              amount: parseFloat(amount),
              from_account_id: fromAccountId, to_account_id: toAccountId,
            };
          }
          break;
        }
      }

      // 相似记录检测
      let dupQuery = supabase.from('transactions').select('id')
        .eq('user_id', user.id)
        .eq('transaction_date', base.transaction_date)
        .eq('type', formType)
        .eq('is_deleted', false)
        .limit(1);
      if (formType === 'exchange') {
        dupQuery = dupQuery.eq('from_amount', data.from_amount);
      } else if (formType === 'transfer' && data.from_amount) {
        dupQuery = dupQuery.eq('from_amount', data.from_amount);
      } else {
        dupQuery = dupQuery.eq('amount', data.amount);
      }
      const { data: existing } = await dupQuery;
      if (existing && existing.length > 0) {
        const confirmed = await new Promise<boolean>((resolve) => {
          Dialog.confirm({
            title: '疑似重复记录',
            content: '检测到同日已有相同类型和金额的记录，确定要继续提交吗？',
            onConfirm: () => { resolve(true); },
            onCancel: () => { resolve(false); },
          });
        });
        if (!confirmed) return;
      }

      const { error } = await supabase.from('transactions').insert(data);

      if (error) {
        Toast.show({ icon: 'fail', content: '提交失败: ' + error.message });
      } else {
        Toast.show({ icon: 'success', content: '记录成功' });
        resetForm();
        loadData();
      }
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  };

  const resetForm = () => {
    setShowForm(false);
    setDirection('');
    setCurrency(''); setAmount('');
    setFromCurrency(''); setToCurrency('');
    setFromAmount(''); setToAmount('');
    setExchangeRate('');
    setFromAccountId(''); setToAccountId('');
    setNotes('');
    setImageFile(null);
  };

  // 添加账户
  const handleAddAccount = async () => {
    if (!user || !newAccountType || !newAccountName || !newAccountCurrency) {
      Toast.show({ icon: 'fail', content: '请填写完整' });
      return;
    }
    const { error } = await supabase.from('accounts').insert({
      user_id: user.id,
      account_type: newAccountType,
      name: newAccountName,
      currency: newAccountCurrency,
      initial_balance: newAccountInitBalance ? parseFloat(newAccountInitBalance) : 0,
    });
    if (error) {
      Toast.show({ icon: 'fail', content: '添加失败' });
    } else {
      Toast.show({ icon: 'success', content: '账户已添加' });
      setShowAccountForm(false);
      setNewAccountType(''); setNewAccountName('');
      setNewAccountCurrency(''); setNewAccountInitBalance('');
      loadData();
    }
  };

  const myAccounts = accounts.filter(a => a.user_id === user?.id);

  return (
    <div style={{ padding: 16, paddingBottom: 70 }}>
      {/* 用户信息 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <span style={{ fontSize: 18, fontWeight: 600 }}>👋 {user?.name}</span>
          <Tag color="primary" style={{ marginLeft: 8 }}>{user?.role === 'admin' ? '管理员' : '记账人'}</Tag>
        </div>
        <Button size="small" color="primary" onClick={() => setShowForm(true)}>
          <AddOutline /> 新增记录
        </Button>
      </div>

      {/* 当日/补记 已提交 */}
      {(() => {
        const isBackdating = !dayjs(txDate).isSame(dayjs(), 'day');
        const sectionTitle = isBackdating
          ? `📋 补记 ${dayjs(txDate).format('MM/DD')} 已提交 ${dateRecords.length} 条`
          : `📋 今天 (${dayjs().format('MM/DD')}) 已提交 ${dateRecords.length} 条`;
        return (
          <>
            {isBackdating && (
              <Tag color="warning" style={{ marginBottom: 8, display: 'inline-block' }}>
                ⚠️ 当前为补记模式，记录日期为 {dayjs(txDate).format('MM-DD')}
              </Tag>
            )}
            <div style={{
              background: '#fff', borderRadius: 12, padding: 16, marginBottom: 12,
              boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
            }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>
                {sectionTitle}
              </div>
              {dateRecords.length === 0 ? (
                <p style={{ color: '#999', fontSize: 13, margin: 0 }}>暂无记录</p>
              ) : (
                dateRecords.map(r => (
            <div key={r.id} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '6px 0', borderBottom: '1px solid #f0f0f0', fontSize: 14,
            }}>
              <span>
                {r.type === 'expense' ? '💸 付款' : r.type === 'income' ? '💰 收款' : r.type === 'exchange' ? '🔄 换汇' : '📤 转款'}
                {' '}{r.currency || r.from_currency}{' '}
                {r.amount || r.from_amount}
              </span>
              <span style={{ color: '#999', display: 'flex', alignItems: 'center', gap: 8 }}>
                {r.image_url && '📷 '}
                {r.notes?.slice(0, 10)}
                <span
                  style={{ color: '#ff4d4f', cursor: 'pointer', marginLeft: 4, fontSize: 13 }}
                  onClick={(e) => { e.stopPropagation(); handleDeleteRecord(r.id); }}
                >删除</span>
              </span>
            </div>
          ))
        )}
      </div>
          </>
        );
      })()}

      {/* 新增记录表单 (Popup 弹出) */}
      <Popup
        visible={showForm}
        onMaskClick={() => setShowForm(false)}
        position="bottom"
        bodyStyle={{ height: '85vh', borderTopLeftRadius: 16, borderTopRightRadius: 16, overflow: 'auto' }}
      >
        <div style={{ padding: 20 }}>
          <h3 style={{ margin: '0 0 16px' }}>新增记录</h3>

          {/* 选择类型 */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ marginBottom: 8, fontSize: 14, color: '#666' }}>记录类型</div>
            <Selector
              options={RECORD_TYPES}
              value={[formType]}
              onChange={(arr) => { if (arr.length) { setFormType(arr[0]); resetForm(); setShowForm(true); } }}
            />
          </div>

          {/* 方向 (付款/收款/转款) */}
          {(formType === 'expense' || formType === 'income') && (
            <Form.Item label="方向">
              <Selector
                options={DIRECTIONS}
                value={direction ? [direction] : []}
                onChange={(arr) => setDirection(arr[0] || '')}
              />
            </Form.Item>
          )}
          {formType === 'transfer' && (
            <Form.Item label="方向">
              <Selector
                options={TRANSFER_DIRECTIONS}
                value={direction ? [direction] : []}
                onChange={(arr) => setDirection(arr[0] || '')}
              />
            </Form.Item>
          )}

          {/* 单一币种+金额 (付款/收款) */}
          {['expense', 'income'].includes(formType) && (
            <>
              <Form.Item label="币种">
                <Selector
                  options={CURRENCIES.filter(Boolean).map(c => ({ label: c, value: c }))}
                  value={currency ? [currency] : []}
                  onChange={(arr) => setCurrency(arr[0] || '')}
                />
              </Form.Item>
              <Form.Item label="金额">
                <Input
                  placeholder="输入金额"
                  type="number"
                  value={amount}
                  onChange={setAmount}
                  style={{ fontSize: 20, fontWeight: 600 }}
                />
              </Form.Item>
            </>
          )}

          {/* 换汇双币种+双金额 */}
          {formType === 'exchange' && (
            <>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <Form.Item label="从币种">
                    <Selector
                      options={CURRENCIES.filter(Boolean).map(c => ({ label: c, value: c }))}
                      value={fromCurrency ? [fromCurrency] : []}
                      onChange={(arr) => setFromCurrency(arr[0] || '')}
                    />
                  </Form.Item>
                </div>
                <div style={{ flex: 1 }}>
                  <Form.Item label="换成">
                    <Selector
                      options={CURRENCIES.filter(Boolean).map(c => ({ label: c, value: c }))}
                      value={toCurrency ? [toCurrency] : []}
                      onChange={(arr) => setToCurrency(arr[0] || '')}
                    />
                  </Form.Item>
                </div>
              </div>
              <Form.Item label="付出金额">
                <Input placeholder="比如 15000" type="number" value={fromAmount} onChange={setFromAmount} />
              </Form.Item>
              <Form.Item label="得到金额">
                <Input placeholder="比如 1250" type="number" value={toAmount} onChange={setToAmount} />
              </Form.Item>
              <Form.Item label="汇率">
                <Input placeholder="比如 0.0833" type="number" value={exchangeRate} onChange={setExchangeRate} />
              </Form.Item>
            </>
          )}

          {/* 转款：出账/入账账户 + 金额 */}
          {formType === 'transfer' && (() => {
            const fromAcc = myAccounts.find(a => a.id === fromAccountId);
            const toAcc = myAccounts.find(a => a.id === toAccountId);
            const fromCur = fromAcc?.currency || '';
            const toCur = toAcc?.currency || '';
            const isCross = fromCur && toCur && fromCur !== toCur;

            return (
              <>
                <Form.Item label="从账户出">
                  <Selector
                    options={myAccounts.map(a => ({ label: `${a.name} (${a.currency})`, value: a.id }))}
                    value={fromAccountId ? [fromAccountId] : []}
                    onChange={(arr) => {
                      const id = arr[0] || '';
                      setFromAccountId(id);
                      const acc = myAccounts.find(a => a.id === id);
                      if (acc) {
                        setFromCurrency(acc.currency);
                        if (!toAccountId) setCurrency(acc.currency);
                      }
                    }}
                  />
                  {myAccounts.length === 0 && <span style={{ color: '#ff4d4f', fontSize: 12 }}>请先在"我的账户"中添加账户</span>}
                </Form.Item>
                <Form.Item label="入账账户">
                  <Selector
                    options={myAccounts.map(a => ({ label: `${a.name} (${a.currency})`, value: a.id }))}
                    value={toAccountId ? [toAccountId] : []}
                    onChange={(arr) => {
                      const id = arr[0] || '';
                      setToAccountId(id);
                      const acc = myAccounts.find(a => a.id === id);
                      if (acc) setToCurrency(acc.currency);
                    }}
                  />
                </Form.Item>
                {fromCur && toCur && (
                  <div style={{ fontSize: 12, color: isCross ? '#fa8c16' : '#52c41a', marginBottom: 12 }}>
                    {isCross ? `⚠️ 跨币种: ${fromCur} → ${toCur}` : `✅ 同币种: ${fromCur}`}
                  </div>
                )}
                {isCross ? (
                  <>
                    <Form.Item label={`付出金额 (${fromCur})`}>
                      <Input placeholder="比如 10000" type="number" value={fromAmount} onChange={(v) => {
                        setFromAmount(v);
                        const fa = parseFloat(v);
                        const er = parseFloat(exchangeRate);
                        if (fa && er) setToAmount((fa * er).toFixed(2));
                      }} />
                    </Form.Item>
                    <Form.Item label={`汇率 (${fromCur}→${toCur})`}>
                      <Input placeholder="比如 7.25" type="number" value={exchangeRate} onChange={(v) => {
                        setExchangeRate(v);
                        const fa = parseFloat(fromAmount);
                        const er = parseFloat(v);
                        if (fa && er) setToAmount((fa * er).toFixed(2));
                      }} />
                    </Form.Item>
                    <Form.Item label={`到账金额 (${toCur})`}>
                      <Input placeholder="自动计算" type="number" value={toAmount} onChange={(v) => {
                        setToAmount(v);
                        const fa = parseFloat(fromAmount);
                        const ta = parseFloat(v);
                        if (fa && ta && fa !== 0) setExchangeRate((ta / fa).toFixed(6));
                      }} />
                    </Form.Item>
                  </>
                ) : (
                  <Form.Item label="金额">
                    <Input
                      placeholder="输入金额" type="number"
                      value={amount}
                      onChange={setAmount}
                      style={{ fontSize: 20, fontWeight: 600 }}
                    />
                  </Form.Item>
                )}
              </>
            );
          })()}

          {/* 出账账户 */}
          {['expense', 'exchange'].includes(formType) && (
            <Form.Item label="从账户出">
              <Selector
                options={myAccounts.map(a => ({ label: `${a.name} (${a.currency})`, value: a.id }))}
                value={fromAccountId ? [fromAccountId] : []}
                onChange={(arr) => setFromAccountId(arr[0] || '')}
              />
              {myAccounts.length === 0 && <span style={{ color: '#ff4d4f', fontSize: 12 }}>请先在"我的账户"中添加账户</span>}
            </Form.Item>
          )}

          {/* 入账账户 */}
          {['income', 'exchange'].includes(formType) && (
            <Form.Item label="入账账户">
              <Selector
                options={myAccounts.map(a => ({ label: `${a.name} (${a.currency})`, value: a.id }))}
                value={toAccountId ? [toAccountId] : []}
                onChange={(arr) => setToAccountId(arr[0] || '')}
              />
            </Form.Item>
          )}

          {/* 日期 */}
          <Form.Item label="日期">
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              {[
                { label: '今天', date: new Date() },
                { label: '昨天', date: dayjs().subtract(1, 'day').toDate() },
                { label: '前天', date: dayjs().subtract(2, 'day').toDate() },
              ].map(({ label, date }) => (
                <Button
                  key={label}
                  size="mini"
                  fill={dayjs(txDate).isSame(date, 'day') ? 'solid' : 'outline'}
                  color={dayjs(txDate).isSame(date, 'day') ? 'primary' : 'default'}
                  onClick={() => setTxDate(date)}
                  style={{ fontSize: 12 }}
                >
                  {label}
                </Button>
              ))}
            </div>
            <DatePicker
              value={txDate}
              onConfirm={(val) => val && setTxDate(val)}
            >
              {(value) => <div>{value ? dayjs(value).format('YYYY-MM-DD') : '选择日期'}</div>}
            </DatePicker>
            {!dayjs(txDate).isSame(dayjs(), 'day') && (
              <Button
                size="mini"
                color="primary"
                fill="none"
                onClick={() => setTxDate(new Date())}
                style={{ fontSize: 12, marginTop: 6 }}
              >
                回到今天
              </Button>
            )}
          </Form.Item>

          {/* 备注 */}
          <Form.Item label="备注">
            <TextArea placeholder="为什么付/收/换/转？" value={notes} onChange={setNotes} rows={2} />
          </Form.Item>

          {/* 凭证照片 */}
          <Form.Item label="📷 凭证照片（可选）">
            <ImageUploader
              value={imageFile ? [{ url: URL.createObjectURL(imageFile), key: 'preview' }] : []}
              onChange={(items) => {
                if (items.length === 0) setImageFile(null);
              }}
              upload={async (file) => {
                setImageFile(file);
                return { url: URL.createObjectURL(file) };
              }}
              maxCount={1}
            />
          </Form.Item>

          <Button block color="primary" size="large" loading={loading} onClick={handleSubmit} style={{ borderRadius: 8 }}>
            提交记录
          </Button>
        </div>
      </Popup>

      {/* 历史记录 — 折叠区 */}
      <Collapse defaultActiveKey={[]}>
        <Collapse.Panel key="history" title="📂 历史记录">
          <HistoryList userId={user?.id || ''} />
        </Collapse.Panel>
        <Collapse.Panel key="accounts" title="🏦 我的账户">
          <div style={{ padding: '8px 0' }}>
            {myAccounts.map(a => (
              <div key={a.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '8px 0', borderBottom: '1px solid #f0f0f0',
              }}>
                <span>
                  {ACCOUNT_TYPES.find(t => t.value === a.account_type)?.icon} {a.name}
                  <Tag style={{ marginLeft: 8 }}>{a.currency}</Tag>
                </span>
              </div>
            ))}
            <Button
              block color="primary" fill="outline" size="small"
              style={{ marginTop: 12 }}
              onClick={() => setShowAccountForm(true)}
            >
              <AddOutline /> 添加账户
            </Button>
          </div>
        </Collapse.Panel>
      </Collapse>

      {/* 添加账户 Popup */}
      <Popup
        visible={showAccountForm}
        onMaskClick={() => setShowAccountForm(false)}
        position="bottom"
        bodyStyle={{ borderTopLeftRadius: 16, borderTopRightRadius: 16 }}
      >
        <div style={{ padding: 20 }}>
          <h3>添加账户</h3>
          <Form.Item label="账户类型">
            <Selector
              options={ACCOUNT_TYPES.map(t => ({ label: `${t.icon} ${t.label}`, value: t.value }))}
              value={newAccountType ? [newAccountType] : []}
              onChange={(arr) => setNewAccountType(arr[0] || '')}
            />
          </Form.Item>
          <Form.Item label="账户名称">
            <Input placeholder="如: 招行储蓄卡" value={newAccountName} onChange={setNewAccountName} />
          </Form.Item>
          <Form.Item label="币种">
            <Selector
              options={CURRENCIES.filter(Boolean).map(c => ({ label: c, value: c }))}
              value={newAccountCurrency ? [newAccountCurrency] : []}
              onChange={(arr) => setNewAccountCurrency(arr[0] || '')}
            />
          </Form.Item>
          <Form.Item label="期初余额（选填）">
            <Input placeholder="0" type="number" value={newAccountInitBalance} onChange={setNewAccountInitBalance} />
          </Form.Item>
          <Button block color="primary" onClick={handleAddAccount} style={{ borderRadius: 8 }}>
            保存账户
          </Button>
        </div>
      </Popup>
    </div>
  );
}

// 历史记录列表子组件
function HistoryList({ userId }: { userId: string }) {
  const [records, setRecords] = useState<Transaction[]>([]);
  const [historyDays, setHistoryDays] = useState(30);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    const startDate = dayjs().subtract(historyDays, 'day').format('YYYY-MM-DD');
    const endDate = dayjs().format('YYYY-MM-DD');
    supabase.from('transactions').select('*')
      .eq('user_id', userId).eq('is_deleted', false)
      .gte('transaction_date', startDate)
      .lte('transaction_date', endDate)
      .order('transaction_date', { ascending: false })
      .limit(100)
      .then(({ data }) => {
        if (data) {
          setRecords(data);
          setHasMore(data.length >= 100);
        }
        setLoading(false);
      });
  }, [userId, historyDays]);

  const loadMore = () => {
    setHistoryDays(prev => prev + 30);
  };

  const handleDelete = async (id: string) => {
    const confirmed = await new Promise<boolean>((resolve) => {
      Dialog.confirm({
        title: '确认删除',
        content: '确定要删除这条记录吗？',
        onConfirm: () => { resolve(true); },
        onCancel: () => { resolve(false); },
      });
    });
    if (!confirmed) return;
    const { error } = await supabase.from('transactions').update({ is_deleted: true }).eq('id', id);
    if (error) {
      Toast.show({ icon: 'fail', content: '删除失败' });
    } else {
      Toast.show({ icon: 'success', content: '已删除' });
      setRecords(prev => prev.filter(r => r.id !== id));
    }
  };

  return (
    <div>
      {records.map(r => (
        <div key={r.id} style={{ padding: '8px 0', borderBottom: '1px solid #f0f0f0', fontSize: 13 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>
              {r.type === 'expense' ? '💸' : r.type === 'income' ? '💰' : r.type === 'exchange' ? '🔄' : '📤'}
              {' '}{r.type === 'exchange' ? `${r.from_currency}→${r.to_currency}` : r.currency}
              {' '}{r.amount || `${r.from_amount}→${r.to_amount}`}
            </span>
            <span style={{ color: '#999', display: 'flex', alignItems: 'center', gap: 8 }}>
              {r.transaction_date}
              <span
                style={{ color: '#ff4d4f', cursor: 'pointer', marginLeft: 4, fontSize: 11 }}
                onClick={(e) => { e.stopPropagation(); handleDelete(r.id); }}
              >删除</span>
            </span>
          </div>
          {r.notes && <div style={{ color: '#666', marginTop: 2 }}>{r.notes}</div>}
          {r.image_url && <div style={{ color: '#1677ff' }}>📷 有凭证</div>}
        </div>
      ))}
      {records.length === 0 && !loading && <p style={{ color: '#999', textAlign: 'center' }}>暂无记录</p>}
      {hasMore && (
        <Button
          block fill="none" size="small"
          style={{ marginTop: 8 }}
          loading={loading}
          onClick={loadMore}
        >
          加载更早记录
        </Button>
      )}
    </div>
  );
}
