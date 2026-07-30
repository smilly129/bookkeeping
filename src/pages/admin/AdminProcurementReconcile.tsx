import { useState, useEffect } from 'react';
import {
  Table, Card, Statistic, Button, Modal, Form, Input, InputNumber,
  Select, DatePicker, message, Popconfirm, Space, Tag, Tabs, Collapse,
  Row, Col, Upload, Alert,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, EditOutlined, ExportOutlined,
  UploadOutlined, CheckCircleOutlined, WarningOutlined,
  EyeOutlined, LinkOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import * as XLSX from 'xlsx';
import { supabase, type ProcurementTransfer, type ProcurementExcelRecord, type ExcelItem, type ProcurementReconciliation, TRANSFER_TYPES } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';

// 流水表行
interface LedgerRow {
  key: string;
  date: string;
  type: 'transfer' | 'proxy' | 'payment';
  typeLabel: string;
  customer_code?: string;
  income: number;
  expense: number;
  balance: number;
  notes: string;
  sourceId: string;
  sourceTable: string;
}

export default function AdminProcurementReconcile() {
  const { user } = useAuth();

  // ========== 状态 ==========
  const [transfers, setTransfers] = useState<ProcurementTransfer[]>([]);
  const [excelRecords, setExcelRecords] = useState<ProcurementExcelRecord[]>([]);
  const [reconciliations, setReconciliations] = useState<ProcurementReconciliation[]>([]);
  const [purchases, setPurchases] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // 截止日期
  const [cutoffDate, setCutoffDate] = useState(dayjs().format('YYYY-MM-DD'));

  // 期初余额
  const [openingBalance, setOpeningBalance] = useState(0);
  const [openingDate, setOpeningDate] = useState('');

  // 转款弹窗
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferForm, setTransferForm] = useState({
    amount: '' as string,
    transfer_date: dayjs(),
    transfer_type: 'transfer' as 'transfer' | 'proxy',
    notes: '',
  });
  const [transferLoading, setTransferLoading] = useState(false);
  const [editingTransferId, setEditingTransferId] = useState<string | null>(null);

  // Excel 上传
  const [uploadOpen, setUploadOpen] = useState(false);
  const [parsedRecords, setParsedRecords] = useState<ProcurementExcelRecord[]>([]);
  const [uploadDiff, setUploadDiff] = useState<{
    unchanged: ProcurementExcelRecord[];
    new: ProcurementExcelRecord[];
    changed: { old: ProcurementExcelRecord; new: ProcurementExcelRecord }[];
    removed: ProcurementExcelRecord[];
  }>({ unchanged: [], new: [], changed: [], removed: [] });
  const [uploadSaving, setUploadSaving] = useState(false);

  // 采购单核对展开
  const [expandedDetail, setExpandedDetail] = useState<string | null>(null);

  // 关联采购单弹窗
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [linkingRecord, setLinkingRecord] = useState<ProcurementExcelRecord | null>(null);
  const [linkPurchaseId, setLinkPurchaseId] = useState<string | null>(null);

  // 对账弹窗
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [reconcileActual, setReconcileActual] = useState<string>('');
  const [reconcileNotes, setReconcileNotes] = useState('');
  const [reconcileLoading, setReconcileLoading] = useState(false);

  // 期初设置弹窗
  const [openingOpen, setOpeningOpen] = useState(false);
  const [openingFormBalance, setOpeningFormBalance] = useState<string>('');
  const [openingFormDate, setOpeningFormDate] = useState(dayjs());

  // 对账详情弹窗
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailRecord, setDetailRecord] = useState<ProcurementReconciliation | null>(null);

  // ========== 数据加载 ==========
  const loadData = async () => {
    setLoading(true);
    try {
      const [
        { data: t }, { data: e }, { data: r }, { data: ps },
      ] = await Promise.all([
        supabase.from('procurement_transfers').select('*').order('transfer_date', { ascending: true }),
        supabase.from('procurement_excel_records').select('*').eq('is_active', true).order('record_date', { ascending: true }),
        supabase.from('procurement_reconciliations').select('*').order('created_at', { ascending: false }).limit(50),
        supabase.from('purchase_summary').select('*').order('created_at', { ascending: false }),
      ]);

      if (t) setTransfers(t as ProcurementTransfer[]);
      if (e) setExcelRecords(e as ProcurementExcelRecord[]);
      if (r) setReconciliations(r as ProcurementReconciliation[]);
      if (ps) setPurchases(ps);

      // 期初余额从最近一次对账中获取
      if (r && r.length > 0) {
        const last = r[0] as ProcurementReconciliation;
        setOpeningBalance(last.opening_balance);
        setOpeningDate(last.reconcile_date);
      }
    } catch (err) {
      console.error('loadData error:', err);
    }
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  // ========== 按截止日期过滤 ==========
  const filteredTransfers = transfers.filter(t => t.transfer_date <= cutoffDate);
  const filteredExcelRecords = excelRecords.filter(r => r.record_date <= cutoffDate);

  // ========== 计算汇总 ==========
  const totalTransfers = filteredTransfers.reduce((sum, t) => sum + (t.amount || 0), 0);
  const totalPayments = filteredExcelRecords.reduce((sum, r) => sum + ((r.total_procurement || 0) - (r.pending_balance || 0) + (r.refund_amount || 0)), 0);
  const systemBalance = openingBalance + totalTransfers - totalPayments;

  // ========== 流水表 ==========
  const buildLedgerRows = (): LedgerRow[] => {
    const rows: LedgerRow[] = [];

    // 期初余额
    if (openingBalance !== 0) {
      rows.push({
        key: 'opening',
        date: openingDate || '-',
        type: 'transfer',
        typeLabel: '期初',
        income: openingBalance,
        expense: 0,
        balance: openingBalance,
        notes: '期初余额',
        sourceId: 'opening',
        sourceTable: 'system',
      });
    }

    // 转款和代付
    filteredTransfers.forEach(t => {
      rows.push({
        key: `transfer-${t.id}`,
        date: t.transfer_date,
        type: t.transfer_type,
        typeLabel: TRANSFER_TYPES.find(x => x.value === t.transfer_type)?.label || t.transfer_type,
        income: t.amount,
        expense: 0,
        balance: 0,
        notes: t.notes || '',
        sourceId: t.id,
        sourceTable: 'transfers',
      });
    });

    // Excel 采购付款
    filteredExcelRecords.forEach(r => {
      const netPayment = (r.total_procurement || 0) - (r.pending_balance || 0) + (r.refund_amount || 0);
      rows.push({
        key: `payment-${r.id}`,
        date: r.record_date,
        type: 'payment',
        typeLabel: '采购',
        customer_code: r.customer_code,
        income: 0,
        expense: netPayment,
        balance: 0,
        notes: r.pending_balance ? `待付${r.pending_balance}` : r.refund_amount ? `回款${r.refund_amount}` : '',
        sourceId: r.id,
        sourceTable: 'excel_records',
      });
    });

    // 按日期排序
    rows.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      // 同期初优先
      if (a.typeLabel === '期初') return -1;
      if (b.typeLabel === '期初') return 1;
      return 0;
    });

    // 计算 running balance
    let running = openingBalance;
    // 先找出期初行
    const openingRow = rows.find(r => r.typeLabel === '期初');
    const otherRows = rows.filter(r => r.typeLabel !== '期初');
    const sorted = openingRow ? [openingRow, ...otherRows] : otherRows;

    sorted.forEach(r => {
      running = running + r.income - r.expense;
      r.balance = running;
    });

    return sorted;
  };

  const ledgerRows = buildLedgerRows();

  // ========== Excel 解析 ==========
  const parseExcel = (file: File): Promise<ProcurementExcelRecord[]> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = e.target?.result;
          const wb = XLSX.read(data, { type: 'binary' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const json = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false }) as any[][];

          // 将 Excel 序列日期数字转为日期字符串
          const serialToDate = (v: any): string | null => {
            if (!v) return null;
            if (v instanceof Date) return dayjs(v).format('YYYY-MM-DD');
            const num = parseFloat(String(v));
            if (num > 40000 && num < 70000) {
              // Excel 序列号转日期 (1900-01-01 = 1)
              const d = new Date((num - 25569) * 86400 * 1000);
              return dayjs(d).format('YYYY-MM-DD');
            }
            const s = String(v).trim();
            const m = s.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
            if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
            return null;
          };

          const records: ProcurementExcelRecord[] = [];
          let currentDate = '';
          let currentCustomer = '';
          let currentQuoted: number | null = null;
          let currentItems: ExcelItem[] = [];

          const saveCurrentBlock = () => {
            if (currentCustomer && currentItems.length > 0) {
              const totalAmount = currentItems.reduce((s, i) => s + (i.qty * i.unit_price), 0);
              const totalExpress = currentItems.reduce((s, i) => s + i.express, 0);
              const totalProcurement = currentItems.reduce((s, i) => s + i.procurement_price, 0);
              records.push({
                id: '', record_date: currentDate,
                customer_code: currentCustomer,
                quoted_price: currentQuoted,
                items: currentItems,
                total_amount: +totalAmount.toFixed(2),
                total_express: +totalExpress.toFixed(2),
                total_procurement: +totalProcurement.toFixed(2),
                amount_diff: +((totalAmount + totalExpress) - totalProcurement).toFixed(2),
                purchase_id: null,
                upload_batch_id: '',
                is_active: true,
                created_at: '',
              });
            }
            currentItems = [];
          };

          // 清洗货币格式: "¥1,234.56" → 1234.56
          const cleanFloat = (v: any): number => {
            if (v == null || v === '') return 0;
            const s = String(v).replace(/[¥￥$元,，\s]/g, '');
            const n = parseFloat(s);
            return isNaN(n) ? 0 : n;
          };

          for (const row of json) {
            if (!row || row.length === 0) continue;

            const colA = String(row[0] ?? '').trim();
            const colB = row[1];
            const colH = cleanFloat(row[7]);  // 数量
            const colI = cleanFloat(row[8]);  // 单价
            const colJ = cleanFloat(row[9]);  // 金额
            const colK = cleanFloat(row[10]); // 快递费
            const colL = cleanFloat(row[11]); // 采购价

            // 日期行（支持字符串日期和序列数字日期）
            const dateStr = serialToDate(row[0]);
            if (dateStr || colA.match(/^\d{4}-\d{2}-\d{2}/)) {
              saveCurrentBlock();
              currentCustomer = '';
              currentQuoted = null;
              if (dateStr) currentDate = dateStr;
              continue;
            }

            // 表头行
            if (colA === '客户代码') continue;

            // 跳过月份标题行和非客户行（如 "2026/7月份"）
            if (colA && (colA.includes('月') || colA.includes('年') || colA.includes('份') || /^\d{4}\/\d+/.test(colA))) continue;

            // 客户数据行：A列有客户代码
            if (colA && !colA.match(/^\d{4}-\d{2}-\d{2}/) && colA !== '客户代码') {
              // 保存上一个客户块
              saveCurrentBlock();
              currentCustomer = colA;
              currentQuoted = colB ? cleanFloat(colB) : null;
              // 如果该行也有采购价数据，加入明细
              if (colL > 0 && (colH > 0 || colJ > 0)) {
                currentItems.push({
                  size: String(row[6] ?? '').trim() || undefined,
                  qty: colH,
                  unit_price: colI,
                  amount: colJ,
                  express: colK,
                  procurement_price: colL,
                });
              }
              continue;
            }

            // 当前客户块的续行或汇总行
            if (currentCustomer) {
              const hasDetail = (colH > 0 || colJ > 0 || colI > 0);
              const hasProcurementOnly = colL > 0 && !hasDetail && colK === 0;
              const hasExpressAndProcurement = colL > 0 && colK > 0 && colH > 0;

              if (hasDetail || hasExpressAndProcurement) {
                // 明细行
                currentItems.push({
                  size: String(row[6] ?? '').trim() || undefined,
                  qty: colH,
                  unit_price: colI,
                  amount: colJ,
                  express: colK,
                  procurement_price: colL,
                });
              } else if (hasProcurementOnly) {
                // 汇总行（只有采购价，没有数量/单价）
                saveCurrentBlock();
                currentCustomer = '';
                currentQuoted = null;
              }
            }
          }
          // 保存最后一个客户块
          saveCurrentBlock();

          resolve(records);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = reject;
      reader.readAsBinaryString(file);
    });
  };

  // ========== 上传处理 ==========
  const handleUpload = async (file: File) => {
    try {
      const parsed = await parseExcel(file);
      console.log('=== 解析结果 ===');
      parsed.forEach((r, i) => console.log(`[${i}] 日期=${r.record_date} 客户=${r.customer_code} 报价=${r.quoted_price} 采购价=${r.total_procurement} 明细=${r.items?.length || 0}行`));
      console.log(`共 ${parsed.length} 条`);
      setParsedRecords(parsed);

      // 增量比对
      const unchanged: ProcurementExcelRecord[] = [];
      const newRecs: ProcurementExcelRecord[] = [];
      const changed: { old: ProcurementExcelRecord; new: ProcurementExcelRecord }[] = [];
      const removed: ProcurementExcelRecord[] = [];

      const existingMap = new Map<string, ProcurementExcelRecord>();
      excelRecords.forEach(r => existingMap.set(`${r.record_date}|${r.customer_code}`, r));

      const parsedKeys = new Set<string>();
      parsed.forEach(p => {
        const key = `${p.record_date}|${p.customer_code}`;
        parsedKeys.add(key);
        const existing = existingMap.get(key);
        if (!existing) {
          // 新记录：尝试从已有记录继承尾款和回款（同客户最新一条）
          const sameCust = excelRecords.filter(x => x.customer_code === p.customer_code && x.is_active);
          if (sameCust.length > 0) {
            const latest = sameCust.reduce((a, b) => a.record_date > b.record_date ? a : b);
            p.pending_balance = latest.pending_balance || 0;
            p.refund_amount = latest.refund_amount || 0;
          }
          newRecs.push(p);
        } else if (
          Math.abs(existing.total_procurement - p.total_procurement) > 0.01
        ) {
          changed.push({ old: existing, new: p });
        } else {
          unchanged.push(existing);
        }
      });

      // 数据库中不存在于新Excel中的记录
      existingMap.forEach((v, k) => {
        if (!parsedKeys.has(k)) removed.push(v);
      });

      setUploadDiff({ unchanged, new: newRecs, changed, removed });
      setUploadOpen(true);

    } catch (err: any) {
      message.error('解析失败: ' + err.message);
    }
    return false; // 阻止默认上传
  };

  // 保存上传
  const handleSaveUpload = async (mode: 'all' | 'new') => {
    setUploadSaving(true);
    try {
      const batchId = `batch_${Date.now()}`;
      const toSaveAll = mode === 'new' ? uploadDiff.new : [...uploadDiff.new, ...uploadDiff.changed.map(c => c.new)];

      // 过滤掉无效记录（没有客户代号或日期）
      const toSave = toSaveAll.filter(r => r.customer_code && r.record_date && r.total_procurement > 0);
      if (toSave.length < toSaveAll.length) {
        message.warning(`跳过 ${toSaveAll.length - toSave.length} 条无效记录（缺少客户代号或日期）`);
      }

      if (toSave.length > 0) {
        const inserts = toSave.map(r => ({
          record_date: r.record_date,
          customer_code: r.customer_code,
          quoted_price: r.quoted_price,
          items: r.items,
          total_amount: r.total_amount,
          total_express: r.total_express,
          total_procurement: r.total_procurement,
          amount_diff: r.amount_diff,
          pending_balance: r.pending_balance || 0,
          refund_amount: r.refund_amount || 0,
          upload_batch_id: batchId,
        }));

        console.log('Saving records:', JSON.stringify(inserts.map(r => ({ ...r, items: `${r.items.length} items` }))));
        const { error } = await supabase.from('procurement_excel_records').insert(inserts);
        if (error) {
          console.error('Insert error:', error);
          throw new Error(`数据库错误: ${error.message} (code: ${error.code})`);
        }
      }

      // 更新变更的记录
      for (const { old: o, new: n } of uploadDiff.changed) {
        if (mode === 'all') {
          await supabase.from('procurement_excel_records').update({
            quoted_price: n.quoted_price,
            items: n.items,
            total_amount: n.total_amount,
            total_express: n.total_express,
            total_procurement: n.total_procurement,
            amount_diff: n.amount_diff,
            upload_batch_id: batchId,
            updated_at: new Date().toISOString(),
          }).eq('id', o.id);
        }
      }

      // 标记删除
      if (mode === 'all' && uploadDiff.removed.length > 0) {
        await supabase.from('procurement_excel_records').update({
          is_active: false,
          updated_at: new Date().toISOString(),
        }).in('id', uploadDiff.removed.map(r => r.id));
      }

      message.success(`已保存（新增${toSave.length}条${mode === 'all' ? `，变更${uploadDiff.changed.length}条，删除${uploadDiff.removed.length}条` : ''}）`);
      setUploadOpen(false);
      loadData();
    } catch (err: any) {
      message.error('保存失败: ' + err.message);
    }
    setUploadSaving(false);
  };

  // ========== 转款 CRUD ==========
  const saveTransfer = async () => {
    if (!transferForm.amount || parseFloat(transferForm.amount) <= 0) {
      message.error('请输入金额'); return;
    }
    setTransferLoading(true);
    const payload = {
      amount: parseFloat(transferForm.amount),
      transfer_date: transferForm.transfer_date.format('YYYY-MM-DD'),
      transfer_type: transferForm.transfer_type,
      notes: transferForm.notes || null,
    };

    try {
      if (editingTransferId) {
        const { error } = await supabase.from('procurement_transfers').update(payload).eq('id', editingTransferId);
        if (error) throw error;
        message.success('已更新');
      } else {
        const { error } = await supabase.from('procurement_transfers').insert(payload);
        if (error) throw error;
        message.success('已添加');
      }
      setTransferOpen(false);
      setEditingTransferId(null);
      setTransferForm({ amount: '', transfer_date: dayjs(), transfer_type: 'transfer', notes: '' });
      loadData();
    } catch (err: any) {
      message.error('保存失败: ' + err.message);
    }
    setTransferLoading(false);
  };

  const deleteTransfer = async (id: string) => {
    await supabase.from('procurement_transfers').delete().eq('id', id);
    message.success('已删除');
    loadData();
  };

  // ========== 关联采购单 ==========
  const handleLinkPurchase = async () => {
    if (!linkingRecord || !linkPurchaseId) return;
    const { error } = await supabase.from('procurement_excel_records').update({
      purchase_id: linkPurchaseId,
      updated_at: new Date().toISOString(),
    }).eq('id', linkingRecord.id);
    if (error) { message.error('关联失败: ' + error.message); return; }
    message.success('已关联');
    setLinkModalOpen(false);
    setLinkingRecord(null);
    setLinkPurchaseId(null);
    loadData();
  };

  // ========== 资金对账 ==========
  const submitReconciliation = async () => {
    const actual = parseFloat(reconcileActual);
    if (isNaN(actual)) { message.error('请输入实际余额'); return; }
    setReconcileLoading(true);
    try {
      const { error } = await supabase.from('procurement_reconciliations').insert({
        reconcile_date: dayjs().format('YYYY-MM-DD'),
        opening_balance: openingBalance,
        total_transfers: totalTransfers,
        total_payments: totalPayments,
        system_balance: systemBalance,
        actual_balance: actual,
        notes: reconcileNotes || null,
        submitted_by: user?.id,
        status: Math.abs(actual - systemBalance) < 0.01 ? 'matched' : 'mismatch',
      });
      if (error) throw error;
      message.success(Math.abs(actual - systemBalance) < 0.01 ? '对账匹配！' : `对账提交，差异: ${(actual - systemBalance).toFixed(2)}`);
      setReconcileOpen(false);
      setReconcileActual('');
      setReconcileNotes('');
      loadData();
    } catch (err: any) {
      message.error('提交失败: ' + err.message);
    }
    setReconcileLoading(false);
  };

  // ========== 采购单匹配查找 ==========
  const findMatchingPurchase = (record: ProcurementExcelRecord) => {
    return purchases.find(p =>
      p.customer_code?.toUpperCase() === record.customer_code.toUpperCase() &&
      p.currency === 'RMB'
    ) || null;
  };

  // ========== 流水表列定义 ==========
  const ledgerColumns = [
    { title: '日期', dataIndex: 'date', key: 'date', width: 100 },
    {
      title: '类型', dataIndex: 'typeLabel', key: 'type', width: 70,
      render: (_: any, r: LedgerRow) => {
        const colorMap: Record<string, string> = { '期初': 'default', '转款': 'blue', '代付': 'purple', '采购': 'orange' };
        return <Tag color={colorMap[r.typeLabel] || 'default'}>{r.typeLabel}</Tag>;
      },
    },
    { title: '客户代号', dataIndex: 'customer_code', key: 'customer', width: 110,
      render: (v: string) => v ? <Tag>{v}</Tag> : '-',
    },
    {
      title: '收入', dataIndex: 'income', key: 'income', width: 110,
      render: (v: number) => v > 0 ? <span style={{ color: '#1677ff', fontWeight: 500 }}>+{v.toLocaleString()}</span> : '-',
    },
    {
      title: '支出', dataIndex: 'expense', key: 'expense', width: 110,
      render: (v: number) => v > 0 ? <span style={{ color: '#ff4d4f', fontWeight: 500 }}>-{v.toLocaleString()}</span> : '-',
    },
    {
      title: '余额', dataIndex: 'balance', key: 'balance', width: 120,
      render: (v: number) => <span style={{ fontWeight: 700, color: v < 0 ? '#ff4d4f' : '#1677ff' }}>{v.toLocaleString()}</span>,
    },
    { title: '备注', dataIndex: 'notes', key: 'notes', ellipsis: true },
    {
      title: '操作', key: 'actions', width: 80,
      render: (_: any, r: LedgerRow) => {
        if (r.sourceTable === 'transfers') {
          return (
            <Space>
              <Button size="small" icon={<EditOutlined />} onClick={() => {
                const t = transfers.find(x => x.id === r.sourceId);
                if (t) {
                  setEditingTransferId(t.id);
                  setTransferForm({
                    amount: String(t.amount),
                    transfer_date: dayjs(t.transfer_date),
                    transfer_type: t.transfer_type,
                    notes: t.notes || '',
                  });
                  setTransferOpen(true);
                }
              }} />
              <Popconfirm title="确定删除?" onConfirm={() => deleteTransfer(r.sourceId)}>
                <Button size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            </Space>
          );
        }
        return null;
      },
    },
  ];

  // ========== 采购单核对列 ==========
  // 尾款/回款更新
  const updatePendRefund = async (id: string, field: 'pending_balance' | 'refund_amount', value: number) => {
    await supabase.from('procurement_excel_records').update({ [field]: value, updated_at: new Date().toISOString() }).eq('id', id);
    setExcelRecords(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  const reconcileColumns = [
    { title: '日期', dataIndex: 'record_date', key: 'date', width: 100 },
    { title: '客户代号', dataIndex: 'customer_code', key: 'customer', width: 110, render: (v: string) => <Tag>{v}</Tag> },
    {
      title: '采购价', dataIndex: 'total_procurement', key: 'procurement', width: 110,
      render: (v: number) => <span style={{ fontWeight: 600 }}>{v.toLocaleString()}</span>,
    },
    {
      title: '待付尾款', key: 'pending', width: 100,
      render: (_: any, r: ProcurementExcelRecord) => (
        <InputNumber size="small" min={0} precision={2} style={{ width: 90 }}
          value={r.pending_balance || 0}
          onChange={(v) => updatePendRefund(r.id, 'pending_balance', v || 0)}
          placeholder="0" />
      ),
    },
    {
      title: '回款', key: 'refund', width: 100,
      render: (_: any, r: ProcurementExcelRecord) => (
        <InputNumber size="small" min={0} precision={2} style={{ width: 90 }}
          value={r.refund_amount || 0}
          onChange={(v) => updatePendRefund(r.id, 'refund_amount', v || 0)}
          placeholder="0" />
      ),
    },
    {
      title: '实付', key: 'net', width: 110,
      render: (_: any, r: ProcurementExcelRecord) => {
        const net = (r.total_procurement || 0) - (r.pending_balance || 0) + (r.refund_amount || 0);
        return <span style={{ fontWeight: 700, color: net < 0 ? '#ff4d4f' : '#1677ff' }}>{net.toLocaleString()}</span>;
      },
    },
    {
      title: '状态', key: 'status', width: 90,
      render: (_: any, r: ProcurementExcelRecord) => {
        const net = (r.total_procurement || 0) - (r.pending_balance || 0) + (r.refund_amount || 0);
        const diff = net - (r.total_procurement || 0);
        if (Math.abs(diff) < 0.01) return <Tag color="success">已结清</Tag>;
        if (diff < 0) return <Tag color="warning">待补款</Tag>;
        return <Tag color="processing">待退款</Tag>;
      },
    },
    { title: '明细数', dataIndex: 'items', key: 'items_count', width: 65,
      render: (items: ExcelItem[]) => `${items.length || 0}行` },
    {
      title: '操作', key: 'actions', width: 160,
      render: (_: any, r: ProcurementExcelRecord) => (
        <Space>
          <Button size="small" icon={<EyeOutlined />}
            onClick={() => setExpandedDetail(expandedDetail === r.id ? null : r.id)}>
            详情
          </Button>
          <Button size="small" icon={<LinkOutlined />}
            onClick={() => { setLinkingRecord(r); setLinkPurchaseId(r.purchase_id); setLinkModalOpen(true); }}>
            关联
          </Button>
        </Space>
      ),
    },
  ];

  // ========== 对账历史列 ==========
  const historyColumns = [
    { title: '日期', dataIndex: 'reconcile_date', key: 'date', width: 100 },
    { title: '应剩余额', dataIndex: 'system_balance', key: 'sys', width: 120, render: (v: number) => v.toLocaleString() },
    { title: '实际余额', dataIndex: 'actual_balance', key: 'actual', width: 120, render: (v: number) => v.toLocaleString() },
    {
      title: '差异', dataIndex: 'difference', key: 'diff', width: 100,
      render: (v: number) => <span style={{ color: v === 0 ? '#52c41a' : '#ff4d4f', fontWeight: 600 }}>{v > 0 ? '+' : ''}{v.toLocaleString()}</span>,
    },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 90,
      render: (s: string) => {
        const map: Record<string, { color: string; icon: any; text: string }> = {
          pending: { color: 'default', icon: null, text: '待处理' },
          matched: { color: 'success', icon: <CheckCircleOutlined />, text: '匹配' },
          mismatch: { color: 'error', icon: <WarningOutlined />, text: '差异' },
          resolved: { color: 'processing', icon: <CheckCircleOutlined />, text: '已处理' },
        };
        const m = map[s] || map.pending;
        return <Tag color={m.color} icon={m.icon}>{m.text}</Tag>;
      },
    },
    { title: '备注', dataIndex: 'notes', key: 'notes', ellipsis: true },
    {
      title: '操作', key: 'actions', width: 160,
      render: (_: any, r: ProcurementReconciliation) => (
        <Space>
          <Button size="small" icon={<EyeOutlined />} onClick={() => { setDetailRecord(r); setDetailOpen(true); }}>查看</Button>
          {r.status === 'mismatch' && (
            <Popconfirm title="标记为已处理?" onConfirm={async () => {
              await supabase.from('procurement_reconciliations').update({ status: 'resolved' }).eq('id', r.id);
              loadData();
            }}>
              <Button size="small">标记处理</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  // ========== 渲染 ==========
  return (
    <div>
      {/* 顶部操作栏 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>📊 采购账户对账</h2>
        <Space>
          <span style={{ color: '#666', fontSize: 14 }}>截止日期:</span>
          <DatePicker
            value={dayjs(cutoffDate)}
            onChange={(d) => setCutoffDate(d ? d.format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD'))}
            style={{ width: 130 }}
            allowClear={false}
          />
          <Upload
            accept=".xlsx,.xls"
            showUploadList={false}
            beforeUpload={(file) => { handleUpload(file); return false; }}
          >
            <Button icon={<UploadOutlined />}>上传Excel</Button>
          </Upload>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => {
            setEditingTransferId(null);
            setTransferForm({ amount: '', transfer_date: dayjs(), transfer_type: 'transfer', notes: '' });
            setTransferOpen(true);
          }}>+ 转款</Button>
          <Button onClick={() => {
            setOpeningFormBalance(String(openingBalance));
            setOpeningFormDate(openingDate ? dayjs(openingDate) : dayjs());
            setOpeningOpen(true);
          }}>期初设置</Button>
          <Button icon={<ExportOutlined />} onClick={() => {
            const headers = ['日期', '类型', '客户代号', '收入', '支出', '余额', '备注'];
            const rows = ledgerRows.map(r => [r.date, r.typeLabel, r.customer_code || '', r.income || '', r.expense || '', r.balance, r.notes]);
            const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${c}"`).join(','))].join('\n');
            const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `采购流水_${dayjs().format('YYYY-MM-DD')}.csv`;
            a.click();
            message.success('导出成功');
          }}>导出流水</Button>
        </Space>
      </div>

      {/* 余额概览 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={6}><Card size="small"><Statistic title="期初余额" value={openingBalance.toLocaleString()} valueStyle={{ color: '#1677ff' }} /></Card></Col>
        <Col xs={12} sm={6}><Card size="small"><Statistic title="累计转款+代付" value={totalTransfers.toLocaleString()} valueStyle={{ color: '#1677ff' }} /></Card></Col>
        <Col xs={12} sm={6}><Card size="small"><Statistic title="累计采购付款" value={totalPayments.toLocaleString()} valueStyle={{ color: '#ff4d4f' }} /></Card></Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic title="应剩余额" value={systemBalance.toLocaleString()}
              valueStyle={{ color: systemBalance < 0 ? '#ff4d4f' : '#1677ff', fontSize: 24 }} />
          </Card>
        </Col>
      </Row>

      {/* 对账快捷入口 */}
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-end' }}>
        <Space>
          <span style={{ color: '#888' }}>
            上次对账: {reconciliations.length > 0 ? reconciliations[0].reconcile_date : '无'}
            {reconciliations.length > 0 && reconciliations[0].status === 'mismatch' &&
              <Tag color="error" style={{ marginLeft: 8 }}>差异{reconciliations[0].difference > 0 ? '+' : ''}{reconciliations[0].difference}</Tag>
            }
          </span>
          <Button type="primary" onClick={() => {
            setReconcileActual('');
            setReconcileNotes('');
            setReconcileOpen(true);
          }}>提交对账</Button>
        </Space>
      </div>

      {/* 流水表 */}
      <Card title="📋 采购账户流水表" style={{ marginBottom: 16 }}>
        <Table
          columns={ledgerColumns}
          dataSource={ledgerRows}
          loading={loading}
          size="small"
          pagination={{ pageSize: 50 }}
          scroll={{ x: 900 }}
          locale={{ emptyText: '暂无流水数据，请上传Excel或添加转款记录' }}
        />
      </Card>

      {/* 采购单核对 */}
      <Collapse style={{ marginBottom: 16 }} items={[{
        key: 'reconcile',
        label: <span style={{ fontWeight: 600 }}>🔍 采购单核对 ({filteredExcelRecords.length}条)</span>,
        children: (
          <div>
            <Table
              columns={reconcileColumns}
              dataSource={filteredExcelRecords}
              rowKey="id"
              loading={loading}
              size="small"
              pagination={{ pageSize: 30 }}
              scroll={{ x: 1100 }}
              locale={{ emptyText: '暂无Excel记录' }}
              expandable={{
                expandedRowRender: (record: ProcurementExcelRecord) => (
                  <div style={{ padding: '12px 24px', background: '#fafafa' }}>
                    <div style={{ fontWeight: 600, marginBottom: 8 }}>📝 {record.customer_code} 明细验算</div>
                    <Table
                      dataSource={record.items.map((item, idx) => ({
                        ...item,
                        key: idx,
                        line_diff: +(item.qty * item.unit_price + item.express - item.procurement_price).toFixed(2),
                      }))}
                      columns={[
                        { title: '尺寸', dataIndex: 'size', width: 80, render: (v: string) => v || '-' },
                        { title: '数量', dataIndex: 'qty', width: 60 },
                        { title: '单价', dataIndex: 'unit_price', width: 80, render: (v: number) => v.toFixed(2) },
                        { title: '金额', dataIndex: 'amount', width: 80, render: (v: number) => v.toFixed(2) },
                        { title: '快递', dataIndex: 'express', width: 80, render: (v: number) => v.toFixed(2) },
                        { title: '采购价', dataIndex: 'procurement_price', width: 100, render: (v: number) => <span style={{ fontWeight: 600 }}>{v.toFixed(2)}</span> },
                        { title: '行差额', dataIndex: 'line_diff', width: 80,
                          render: (v: number) => <Tag color={Math.abs(v) < 0.01 ? 'success' : 'warning'}>{v > 0 ? '+' : ''}{v.toFixed(2)}</Tag>,
                        },
                      ]}
                      size="small"
                      pagination={false}
                      summary={() => {
                        const totalAmt = record.items.reduce((s, i) => s + i.qty * i.unit_price, 0);
                        const totalExp = record.items.reduce((s, i) => s + i.express, 0);
                        const totalProc = record.items.reduce((s, i) => s + i.procurement_price, 0);
                        const itemsMatch = Math.abs(totalProc - record.total_procurement) < 0.01;
                        return (
                          <Table.Summary.Row>
                            <Table.Summary.Cell index={0} colSpan={2}><strong>合计</strong></Table.Summary.Cell>
                            <Table.Summary.Cell index={1}></Table.Summary.Cell>
                            <Table.Summary.Cell index={2}><strong>{totalAmt.toFixed(2)}</strong></Table.Summary.Cell>
                            <Table.Summary.Cell index={3}><strong>{totalExp.toFixed(2)}</strong></Table.Summary.Cell>
                            <Table.Summary.Cell index={4}><strong>{totalProc.toFixed(2)}</strong></Table.Summary.Cell>
                            <Table.Summary.Cell index={5}>
                              <strong style={{ color: Math.abs(record.amount_diff) < 0.01 ? '#52c41a' : '#ff4d4f' }}>
                                {record.amount_diff > 0 ? '+' : ''}{record.amount_diff.toFixed(2)}
                              </strong>
                            </Table.Summary.Cell>
                          </Table.Summary.Row>
                        );
                      }}
                    />
                    <div style={{ marginTop: 12, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                      <span>
                        {Math.abs(record.items.reduce((s, i) => s + i.procurement_price, 0) - record.total_procurement) < 0.01
                          ? <Tag color="success" icon={<CheckCircleOutlined />}>内部验算: Σ采购价 = {record.total_procurement.toFixed(2)} ✓</Tag>
                          : <Tag color="error" icon={<WarningOutlined />}>内部验算: 不一致!</Tag>
                        }
                      </span>
                      <span>
                        {Math.abs(record.amount_diff) < 0.01
                          ? <Tag color="success" icon={<CheckCircleOutlined />}>溢价验算: 金额+快递 = 实付 ✓</Tag>
                          : <Tag color="warning" icon={<WarningOutlined />}>溢价验算: 金额+快递 {(record.total_amount + record.total_express).toFixed(2)} - 实付 {record.total_procurement.toFixed(2)} = {record.amount_diff > 0 ? '+' : ''}{record.amount_diff.toFixed(2)}</Tag>
                        }
                      </span>
                      <span>
                        {(() => {
                          const mp = findMatchingPurchase(record);
                          if (!mp) return <Tag color="default">系统: 未录入采购单</Tag>;
                          const cDiff = record.total_procurement - (mp.actual_cost || 0);
                          return Math.abs(cDiff) < 0.01
                            ? <Tag color="success" icon={<CheckCircleOutlined />}>系统: 采购价与实花一致 ✓</Tag>
                            : <Tag color="error" icon={<WarningOutlined />}>系统: 实花差{cDiff > 0 ? '+' : ''}{cDiff.toFixed(2)}</Tag>;
                        })()}
                      </span>
                    </div>
                  </div>
                ),
                expandedRowKeys: expandedDetail ? [expandedDetail] : [],
                onExpand: (expanded, record) => setExpandedDetail(expanded ? record.id : null),
              }}
            />
          </div>
        ),
      }]} />

      {/* 对账历史 */}
      <Collapse items={[{
        key: 'history',
        label: <span style={{ fontWeight: 600 }}>📜 对账历史 ({reconciliations.length}条)</span>,
        children: (
          <Table
            columns={historyColumns}
            dataSource={reconciliations}
            rowKey="id"
            size="small"
            pagination={{ pageSize: 20 }}
            locale={{ emptyText: '暂无对账记录' }}
          />
        ),
      }]} />

      {/* ========== 弹窗 ========== */}

      {/* 转款弹窗 */}
      <Modal
        title={editingTransferId ? '编辑转款' : '添加转款/代付'}
        open={transferOpen}
        onCancel={() => { setTransferOpen(false); setEditingTransferId(null); }}
        onOk={saveTransfer}
        confirmLoading={transferLoading}
      >
        <Form layout="vertical">
          <Form.Item label="日期" required>
            <DatePicker
              value={transferForm.transfer_date}
              onChange={(d) => setTransferForm({ ...transferForm, transfer_date: d || dayjs() })}
              style={{ width: '100%' }}
            />
          </Form.Item>
          <Form.Item label="金额（人民币）" required>
            <InputNumber
              value={transferForm.amount ? parseFloat(transferForm.amount) : null}
              onChange={(v) => setTransferForm({ ...transferForm, amount: String(v || '') })}
              style={{ width: '100%' }}
              min={0}
              precision={2}
              placeholder="输入金额"
            />
          </Form.Item>
          <Form.Item label="类型" required>
            <Select
              value={transferForm.transfer_type}
              onChange={(v) => setTransferForm({ ...transferForm, transfer_type: v })}
              options={TRANSFER_TYPES.map(t => ({ label: t.label, value: t.value }))}
            />
          </Form.Item>
          <Form.Item label="备注">
            <Input.TextArea
              value={transferForm.notes}
              onChange={(e) => setTransferForm({ ...transferForm, notes: e.target.value })}
              rows={2}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 上传预览/比对弹窗 */}
      <Modal
        title="Excel 导入预览 & 比对"
        open={uploadOpen}
        onCancel={() => setUploadOpen(false)}
        width={800}
        footer={[
          <Button key="cancel" onClick={() => setUploadOpen(false)}>取消</Button>,
          <Button key="new" onClick={() => handleSaveUpload('new')} loading={uploadSaving}>
            仅保存新增 ({uploadDiff.new.length}条)
          </Button>,
          <Button key="all" type="primary" onClick={() => handleSaveUpload('all')} loading={uploadSaving}>
            保存全部变更
            ({uploadDiff.new.length + uploadDiff.changed.length + uploadDiff.removed.length > 0
              ? `新增${uploadDiff.new.length} 变更${uploadDiff.changed.length} 删除${uploadDiff.removed.length}`
              : '无变更'})
          </Button>,
        ]}
      >
        <div style={{ marginBottom: 16 }}>
          <Space>
            {uploadDiff.unchanged.length > 0 && <Tag color="default">✅ {uploadDiff.unchanged.length}条一致</Tag>}
            {uploadDiff.new.length > 0 && <Tag color="blue">🆕 {uploadDiff.new.length}条新增</Tag>}
            {uploadDiff.changed.length > 0 && <Tag color="orange">🔄 {uploadDiff.changed.length}条变更</Tag>}
            {uploadDiff.removed.length > 0 && <Tag color="red">❌ {uploadDiff.removed.length}条删除</Tag>}
            {uploadDiff.new.length === 0 && uploadDiff.changed.length === 0 && uploadDiff.removed.length === 0 && (
              <Tag color="success">所有数据已是最新，无变更</Tag>
            )}
          </Space>
        </div>

        {uploadDiff.new.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 600, marginBottom: 8, color: '#1677ff' }}>🆕 新增记录</div>
            <Table
              dataSource={uploadDiff.new}
              rowKey={(r, i) => `new-${i}`}
              columns={[
                { title: '日期', dataIndex: 'record_date', width: 100 },
                { title: '客户', dataIndex: 'customer_code', width: 110 },

                { title: '明细', dataIndex: 'items', width: 60, render: (items: ExcelItem[]) => `${items.length || 0}行` },
                { title: '采购价', dataIndex: 'total_procurement', width: 120, render: (v: number) => v.toLocaleString() },
              ]}
              size="small"
              pagination={false}
            />
          </div>
        )}

        {uploadDiff.changed.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 600, marginBottom: 8, color: '#fa8c16' }}>🔄 变更记录</div>
            {uploadDiff.changed.map((c, i) => (
              <Alert
                key={i}
                type="warning"
                style={{ marginBottom: 8 }}
                message={
                  <span>
                    <strong>{c.old.customer_code}</strong> ({c.old.record_date}):

                    采购价 {c.old.total_procurement} → {c.new.total_procurement}
                    采购价 {c.old.total_procurement} → {c.new.total_procurement}
                  </span>
                }
              />
            ))}
          </div>
        )}

        {uploadDiff.removed.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 600, marginBottom: 8, color: '#ff4d4f' }}>❌ 将标记删除（Excel中已不存在）</div>
            <Table
              dataSource={uploadDiff.removed}
              rowKey="id"
              columns={[
                { title: '日期', dataIndex: 'record_date', width: 100 },
                { title: '客户', dataIndex: 'customer_code', width: 110 },
                { title: '采购价', dataIndex: 'total_procurement', width: 100, render: (v: number) => v.toLocaleString() },
              ]}
              size="small"
              pagination={false}
            />
          </div>
        )}
      </Modal>

      {/* 关联采购单弹窗 */}
      <Modal
        title={`关联采购单 - ${linkingRecord?.customer_code}`}
        open={linkModalOpen}
        onCancel={() => { setLinkModalOpen(false); setLinkingRecord(null); }}
        onOk={handleLinkPurchase}
      >
        <Form layout="vertical">
          <Form.Item label="选择采购单">
            <Select
              value={linkPurchaseId}
              onChange={setLinkPurchaseId}
              allowClear
              placeholder="搜索采购单..."
              showSearch
              optionFilterProp="label"
              style={{ width: '100%' }}
              options={purchases
                .filter(p => p.customer_code?.toUpperCase() === linkingRecord?.customer_code?.toUpperCase() || !linkingRecord)
                .map((p: any) => ({
                  label: `${p.customer_code} | 报价:${p.quoted_price ?? '-'} 实花:${p.actual_cost ?? '-'} | ${p.status === 'completed' ? '已完成' : '进行中'}`,
                  value: p.id,
                }))
              }
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 期初余额弹窗 */}
      <Modal
        title="期初余额设置"
        open={openingOpen}
        onCancel={() => setOpeningOpen(false)}
        onOk={async () => {
          const bal = parseFloat(openingFormBalance) || 0;
          const date = openingFormDate.format('YYYY-MM-DD');
          // 存入数据库：如果已有对账记录就更新第一条，没有就新建
          if (reconciliations.length > 0) {
            await supabase.from('procurement_reconciliations').update({
              opening_balance: bal, reconcile_date: date,
            }).eq('id', reconciliations[0].id);
          } else {
            await supabase.from('procurement_reconciliations').insert({
              opening_balance: bal, reconcile_date: date,
              system_balance: bal, actual_balance: bal,
              status: 'matched', submitted_by: user?.id,
            });
          }
          setOpeningBalance(bal);
          setOpeningDate(date);
          setOpeningOpen(false);
          message.success('期初余额已设置');
          loadData();
        }}
      >
        <Form layout="vertical">
          <Form.Item label="期初日期">
            <DatePicker value={openingFormDate} onChange={(d) => setOpeningFormDate(d || dayjs())} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="期初余额（人民币）">
            <InputNumber value={parseFloat(openingFormBalance) || 0} onChange={(v) => setOpeningFormBalance(String(v || 0))} style={{ width: '100%' }} min={0} precision={2} />
          </Form.Item>
          <div style={{ color: '#888', fontSize: 13 }}>
            设置采购账户的初始余额。流水表将从此余额开始累计。
          </div>
        </Form>
      </Modal>

      {/* 提交对账弹窗 */}
      <Modal
        title="提交资金对账"
        open={reconcileOpen}
        onCancel={() => setReconcileOpen(false)}
        onOk={submitReconciliation}
        confirmLoading={reconcileLoading}
      >
        <Form layout="vertical">
          <div style={{ marginBottom: 16, padding: 12, background: '#f5f5f5', borderRadius: 8 }}>
            <div>期初余额: <strong>{openingBalance.toLocaleString()}</strong></div>
            <div>累计转款+代付: <strong style={{ color: '#1677ff' }}>{totalTransfers.toLocaleString()}</strong></div>
            <div>累计采购付款: <strong style={{ color: '#ff4d4f' }}>{totalPayments.toLocaleString()}</strong></div>
            <div style={{ fontSize: 16, marginTop: 8 }}>
              应剩余额: <strong style={{ color: systemBalance < 0 ? '#ff4d4f' : '#1677ff' }}>{systemBalance.toLocaleString()}</strong>
            </div>
          </div>
          <Form.Item label="采购员汇报的实际余额" required>
            <InputNumber
              value={reconcileActual ? parseFloat(reconcileActual) : null}
              onChange={(v) => setReconcileActual(String(v || ''))}
              style={{ width: '100%' }}
              precision={2}
              placeholder="输入采购员报的余额"
            />
          </Form.Item>
          <Form.Item label="备注">
            <Input.TextArea value={reconcileNotes} onChange={(e) => setReconcileNotes(e.target.value)} rows={2} />
          </Form.Item>
          {reconcileActual && (
            <div style={{ fontSize: 14 }}>
              差异: <strong style={{ color: Math.abs(parseFloat(reconcileActual) - systemBalance) < 0.01 ? '#52c41a' : '#ff4d4f' }}>
                {(parseFloat(reconcileActual) - systemBalance) > 0 ? '+' : ''}{(parseFloat(reconcileActual) - systemBalance).toFixed(2)}
              </strong>
            </div>
          )}
        </Form>
      </Modal>

      {/* 对账详情弹窗 */}
      <Modal
        title="对账详情"
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
      >
        {detailRecord && (
          <div>
            <Row gutter={[16, 16]}>
              <Col span={12}><Statistic title="对账日期" value={detailRecord.reconcile_date} /></Col>
              <Col span={12}><Statistic title="状态" value={detailRecord.status === 'matched' ? '匹配' : detailRecord.status === 'mismatch' ? '差异' : detailRecord.status === 'resolved' ? '已处理' : '待处理'} /></Col>
              <Col span={12}><Statistic title="期初余额" value={detailRecord.opening_balance.toLocaleString()} /></Col>
              <Col span={12}><Statistic title="累计转款" value={detailRecord.total_transfers.toLocaleString()} /></Col>
              <Col span={12}><Statistic title="累计付款" value={detailRecord.total_payments.toLocaleString()} /></Col>
              <Col span={12}><Statistic title="应剩余额" value={detailRecord.system_balance.toLocaleString()} valueStyle={{ color: '#1677ff' }} /></Col>
              <Col span={12}><Statistic title="实际余额" value={detailRecord.actual_balance.toLocaleString()} /></Col>
              <Col span={12}>
                <Statistic title="差异" value={detailRecord.difference.toLocaleString()}
                  valueStyle={{ color: detailRecord.difference === 0 ? '#52c41a' : '#ff4d4f' }} />
              </Col>
            </Row>
            {detailRecord.notes && <div style={{ marginTop: 16 }}><strong>备注:</strong> {detailRecord.notes}</div>}
          </div>
        )}
      </Modal>
    </div>
  );
}
