import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Mail,
  MessageSquareText,
  Plus,
  Search,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import {
  CustomerInquiry,
  CustomerInquiryChannel,
  CustomerInquiryStatus,
  Product,
  PurchaseOrder,
  StockTransaction,
  Supplier,
} from '../types/inventory';
import {
  buildInventoryContextPayload,
  filterCustomerInquiries,
  validateInquiryInput,
} from '../utils/customerResponseEngine';
import { formatCurrency } from '../utils/inventoryEngine';

interface CustomerResponseViewProps {
  inquiries: CustomerInquiry[];
  products: Product[];
  suppliers: Supplier[];
  transactions: StockTransaction[];
  purchaseOrders: PurchaseOrder[];
  onCreateInquiry: (data: {
    customerName: string;
    customerEmail: string;
    channel: CustomerInquiryChannel;
    subject: string;
    message: string;
    productId?: string;
    orderRef?: string;
  }) => void;
  onSendReply: (inquiryId: string, replyText: string) => void;
  onResolveInquiry: (inquiryId: string) => void;
}

const STATUS_TABS: ('all' | CustomerInquiryStatus)[] = ['all', 'Open', 'Replied', 'Resolved'];
const TONE_OPTIONS = ['Warm & Professional', 'Concise & Direct', 'Wholesale Account'] as const;

export function CustomerResponseView({
  inquiries,
  products,
  suppliers,
  transactions,
  purchaseOrders,
  onCreateInquiry,
  onSendReply,
  onResolveInquiry,
}: CustomerResponseViewProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | CustomerInquiryStatus>('all');
  const [selectedId, setSelectedId] = useState<string | null>(inquiries[0]?.id ?? null);
  const [tone, setTone] = useState<(typeof TONE_OPTIONS)[number]>('Warm & Professional');
  const [replyText, setReplyText] = useState('');
  const [isDrafting, setIsDrafting] = useState(false);
  const [draftError, setDraftError] = useState('');

  // New inquiry modal state
  const [newModalOpen, setNewModalOpen] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [channel, setChannel] = useState<CustomerInquiryChannel>('Email');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [productId, setProductId] = useState('');
  const [orderRef, setOrderRef] = useState('');
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const filtered = useMemo(
    () => filterCustomerInquiries(inquiries, search, statusFilter),
    [inquiries, search, statusFilter]
  );

  const activeInquiry =
    inquiries.find((i) => i.id === selectedId) ?? filtered[0] ?? null;

  useEffect(() => {
    if (activeInquiry) {
      setReplyText(activeInquiry.sentReply ?? activeInquiry.replyDraft ?? '');
      setDraftError('');
    } else {
      setReplyText('');
    }
  }, [activeInquiry?.id]);

  const linkedProduct = activeInquiry?.productId
    ? products.find((p) => p.id === activeInquiry.productId)
    : undefined;

  const linkedPo = linkedProduct
    ? purchaseOrders.find((po) => po.productId === linkedProduct.id && po.status !== 'Received')
    : undefined;

  const handleDraftWithGemini = async () => {
    if (!activeInquiry || isDrafting) return;
    setIsDrafting(true);
    setDraftError('');

    try {
      const inventoryContext = buildInventoryContextPayload(
        products,
        suppliers,
        transactions,
        purchaseOrders
      );
      const res = await fetch('/api/gemini/customer-response', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inquiry: {
            customerName: activeInquiry.customerName,
            channel: activeInquiry.channel,
            subject: activeInquiry.subject,
            message: activeInquiry.message,
            orderRef: activeInquiry.orderRef,
            linkedProductName: linkedProduct?.name,
          },
          inventoryContext,
          tone,
        }),
      });

      const data = (await res.json()) as { draft?: string; error?: string };
      if (!res.ok || !data.draft) {
        setDraftError(
          data.error || 'Unable to generate a Gemini response right now. Check Settings > Secrets.'
        );
        return;
      }

      setReplyText(data.draft);
    } catch {
      setDraftError('Network error reaching the Gemini API endpoint.');
    } finally {
      setIsDrafting(false);
    }
  };

  const handleSendSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!activeInquiry || !replyText.trim()) return;
    onSendReply(activeInquiry.id, replyText.trim());
  };

  const handleCreateSubmit = (e: FormEvent) => {
    e.preventDefault();
    const validation = validateInquiryInput({
      customerName,
      customerEmail,
      subject,
      message,
    });
    if (!validation.valid) {
      setFormErrors(validation.errors);
      return;
    }
    onCreateInquiry({
      customerName: customerName.trim(),
      customerEmail: customerEmail.trim(),
      channel,
      subject: subject.trim(),
      message: message.trim(),
      productId: productId || undefined,
      orderRef: orderRef.trim() || undefined,
    });
    setNewModalOpen(false);
    setCustomerName('');
    setCustomerEmail('');
    setSubject('');
    setMessage('');
    setProductId('');
    setOrderRef('');
    setFormErrors({});
  };

  const statusColor = (status: CustomerInquiryStatus) => {
    if (status === 'Open') return 'text-orange-700';
    if (status === 'Replied') return 'text-emerald-700';
    return 'text-slate-600';
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 tracking-tight">
            Customer Response
          </h1>
          <p className="text-sm text-slate-600 mt-0.5">
            Draft stock-accurate customer replies using Gemini AI and live catalog availability
          </p>
        </div>
        <button
          type="button"
          onClick={() => setNewModalOpen(true)}
          className="px-4 py-2 text-sm font-semibold text-white bg-orange-600 hover:bg-orange-700 rounded-lg transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          <span>New Inquiry</span>
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search
            className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="search"
            aria-label="Search customer inquiries"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customer, email, subject, or order ref..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600"
          />
        </div>

        <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto max-w-full">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setStatusFilter(tab)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                statusFilter === tab
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab === 'all' ? 'All Inquiries' : tab}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
          <p className="font-display text-base font-bold text-slate-900">
            No customer inquiries match your filter
          </p>
          <p className="text-sm text-slate-500 mt-1">
            Clear your search filter or log a new customer inquiry.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Inquiry List */}
          <div className="lg:col-span-5 space-y-3">
            {filtered.map((inq) => {
              const isSelected = activeInquiry?.id === inq.id;
              return (
                <button
                  key={inq.id}
                  type="button"
                  onClick={() => setSelectedId(inq.id)}
                  className={`w-full text-left bg-white border rounded-xl p-4 transition-colors focus:outline-none ${
                    isSelected
                      ? 'border-orange-500 ring-1 ring-orange-500/20'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-slate-500 font-medium">
                      {inq.channel} · {inq.createdAt}
                    </span>
                    <span className={`font-semibold whitespace-nowrap ${statusColor(inq.status)}`}>
                      {inq.status}
                    </span>
                  </div>
                  <h2 className="font-display text-sm font-bold text-slate-900 mt-1.5">
                    {inq.subject}
                  </h2>
                  <p className="text-xs text-slate-600 mt-0.5">
                    {inq.customerName} · {inq.customerEmail}
                  </p>
                  <p className="text-xs text-slate-500 mt-2 line-clamp-2 leading-relaxed">
                    {inq.message}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Active Inquiry & Gemini Response Composer */}
          {activeInquiry && (
            <section
              aria-label={`Customer inquiry from ${activeInquiry.customerName}`}
              className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-5"
            >
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-4 border-b border-slate-100">
                <div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span>{activeInquiry.channel}</span>
                    <span aria-hidden="true">·</span>
                    <span>{activeInquiry.createdAt}</span>
                    {activeInquiry.orderRef && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono text-slate-700">{activeInquiry.orderRef}</span>
                      </>
                    )}
                  </div>
                  <h2 className="font-display text-lg font-bold text-slate-900 mt-1">
                    {activeInquiry.subject}
                  </h2>
                  <p className="text-xs text-slate-600 mt-0.5 flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                    <span>
                      {activeInquiry.customerName} ({activeInquiry.customerEmail})
                    </span>
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-xs font-semibold ${statusColor(activeInquiry.status)}`}>
                    {activeInquiry.status}
                  </span>
                  {activeInquiry.status !== 'Resolved' && (
                    <button
                      type="button"
                      onClick={() => onResolveInquiry(activeInquiry.id)}
                      className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
                    >
                      Mark Resolved
                    </button>
                  )}
                </div>
              </div>

              {/* Customer Message */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
                <p className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <MessageSquareText className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                  <span>Customer Message</span>
                </p>
                <p className="text-sm text-slate-800 leading-relaxed">{activeInquiry.message}</p>
              </div>

              {/* Linked Inventory Context */}
              {linkedProduct && (
                <div className="p-3.5 rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                  <div>
                    <p className="font-semibold text-slate-900">
                      Linked SKU: {linkedProduct.name} ({linkedProduct.sku})
                    </p>
                    <p className="text-slate-600 mt-0.5 font-mono tabular-nums">
                      On hand: {linkedProduct.quantity} units · Retail{' '}
                      {formatCurrency(linkedProduct.sellingPrice)}
                    </p>
                  </div>
                  {linkedPo && (
                    <span className="font-mono text-orange-700 font-medium whitespace-nowrap">
                      Inbound {linkedPo.poNumber}: +{linkedPo.quantity} ETA {linkedPo.expectedDate}
                    </span>
                  )}
                </div>
              )}

              {/* Gemini Drafting Controls */}
              <form onSubmit={handleSendSubmit} className="space-y-3 pt-2 border-t border-slate-100">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <label htmlFor="customer-reply-box" className="text-sm font-semibold text-slate-900">
                    Response Draft
                  </label>
                  <div className="flex items-center gap-2">
                    <select
                      aria-label="Response tone"
                      value={tone}
                      onChange={(e) => setTone(e.target.value as (typeof TONE_OPTIONS)[number])}
                      className="px-2.5 py-1.5 text-xs font-medium bg-white border border-slate-200 rounded-lg"
                    >
                      {TONE_OPTIONS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={handleDraftWithGemini}
                      disabled={isDrafting}
                      className="px-3.5 py-1.5 text-xs font-semibold text-orange-700 bg-orange-50 hover:bg-orange-100 border border-orange-200 disabled:opacity-60 rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{isDrafting ? 'Drafting with Gemini...' : 'Draft with Gemini AI'}</span>
                    </button>
                  </div>
                </div>

                {draftError && (
                  <div
                    role="alert"
                    className="p-3 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2 text-xs text-red-800"
                  >
                    <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" aria-hidden="true" />
                    <span>{draftError}</span>
                  </div>
                )}

                <textarea
                  id="customer-reply-box"
                  rows={5}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Write your reply or click 'Draft with Gemini AI' to generate a stock-aware response..."
                  className="w-full p-3.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600 leading-relaxed"
                />

                {activeInquiry.sentReply && (
                  <p className="text-xs text-emerald-700 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>Last sent on {activeInquiry.repliedAt}</span>
                  </p>
                )}

                <div className="flex items-center justify-end gap-3 pt-1">
                  <button
                    type="submit"
                    disabled={!replyText.trim()}
                    className="px-4 py-2 text-sm font-semibold text-white bg-orange-600 hover:bg-orange-700 disabled:bg-slate-300 rounded-lg transition-colors inline-flex items-center gap-2 whitespace-nowrap"
                  >
                    <Send className="w-4 h-4" aria-hidden="true" />
                    <span>Send & Mark Replied</span>
                  </button>
                </div>
              </form>
            </section>
          )}
        </div>
      )}

      {/* New Customer Inquiry Modal */}
      {newModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/45 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-inquiry-title"
        >
          <div className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 id="new-inquiry-title" className="font-display text-lg font-bold text-slate-900">
                Log Customer Inquiry
              </h2>
              <button
                type="button"
                onClick={() => setNewModalOpen(false)}
                aria-label="Close new inquiry dialog"
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
            <form onSubmit={handleCreateSubmit} noValidate className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="inq-name" className="block text-sm font-medium text-slate-700 mb-1">
                    Customer Name
                  </label>
                  <input
                    id="inq-name"
                    type="text"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                  {formErrors.customerName && (
                    <p className="text-xs text-red-600 mt-1">{formErrors.customerName}</p>
                  )}
                </div>
                <div>
                  <label htmlFor="inq-email" className="block text-sm font-medium text-slate-700 mb-1">
                    Email
                  </label>
                  <input
                    id="inq-email"
                    type="email"
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                  {formErrors.customerEmail && (
                    <p className="text-xs text-red-600 mt-1">{formErrors.customerEmail}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="inq-channel" className="block text-sm font-medium text-slate-700 mb-1">
                    Channel
                  </label>
                  <select
                    id="inq-channel"
                    value={channel}
                    onChange={(e) => setChannel(e.target.value as CustomerInquiryChannel)}
                    className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-lg"
                  >
                    <option value="Email">Email</option>
                    <option value="Web Chat">Web Chat</option>
                    <option value="WhatsApp">WhatsApp</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="inq-order" className="block text-sm font-medium text-slate-700 mb-1">
                    Order Ref (Optional)
                  </label>
                  <input
                    id="inq-order"
                    type="text"
                    value={orderRef}
                    onChange={(e) => setOrderRef(e.target.value)}
                    placeholder="ORD-5940"
                    className="w-full px-3.5 py-2 text-sm font-mono border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="inq-product" className="block text-sm font-medium text-slate-700 mb-1">
                  Related Product (Optional)
                </label>
                <select
                  id="inq-product"
                  value={productId}
                  onChange={(e) => setProductId(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-lg"
                >
                  <option value="">General question (no specific SKU)</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.quantity} in stock)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="inq-subject" className="block text-sm font-medium text-slate-700 mb-1">
                  Subject
                </label>
                <input
                  id="inq-subject"
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-lg"
                />
                {formErrors.subject && (
                  <p className="text-xs text-red-600 mt-1">{formErrors.subject}</p>
                )}
              </div>

              <div>
                <label htmlFor="inq-message" className="block text-sm font-medium text-slate-700 mb-1">
                  Message
                </label>
                <textarea
                  id="inq-message"
                  rows={3}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-lg"
                />
                {formErrors.message && (
                  <p className="text-xs text-red-600 mt-1">{formErrors.message}</p>
                )}
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setNewModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-sm font-semibold text-white bg-orange-600 hover:bg-orange-700 rounded-lg"
                >
                  Save Inquiry
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
