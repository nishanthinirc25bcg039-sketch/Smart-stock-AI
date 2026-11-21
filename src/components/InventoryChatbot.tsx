import { FormEvent, useEffect, useRef, useState } from 'react';
import { AlertCircle, Bot, CheckCircle2, Send, ShieldCheck, User, X } from 'lucide-react';
import {
  ChatMessage,
  ChatProposedAction,
  Product,
  PurchaseOrder,
  StockTransaction,
  Supplier,
} from '../types/inventory';
import { buildInventoryContextPayload } from '../utils/customerResponseEngine';
import { formatCurrency } from '../utils/inventoryEngine';

interface InventoryChatbotProps {
  open: boolean;
  products: Product[];
  transactions: StockTransaction[];
  suppliers: Supplier[];
  purchaseOrders: PurchaseOrder[];
  onClose: () => void;
  onConfirmProposedAction: (action: ChatProposedAction) => void;
}

const SUGGESTED_QUESTIONS = [
  'What needs reordering?',
  'What is my inventory worth?',
  'Which products are selling faster?',
  'Any supplier delivery delays?',
];

export function InventoryChatbot({
  open,
  products,
  transactions,
  suppliers,
  purchaseOrders,
  onClose,
  onConfirmProposedAction,
}: InventoryChatbotProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        'Hi! I am connected to the Gemini API on the server to answer questions about your live catalog, inventory value, reorders, and supplier status. I never modify stock or create orders unless you explicitly confirm.',
      timestamp: 'Now',
      isGuidanceOnly: true,
    },
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [open, messages, isTyping]);

  if (!open) return null;

  const askQuestion = async (questionText: string) => {
    const trimmed = questionText.trim();
    if (!trimmed || isTyping) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
      timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    };

    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput('');
    setIsTyping(true);

    try {
      const inventoryContext = buildInventoryContextPayload(
        products,
        suppliers,
        transactions,
        purchaseOrders
      );

      const res = await fetch('/api/gemini/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          history: nextMessages.map((m) => ({ role: m.role, content: m.content })),
          inventoryContext,
        }),
      });

      const data = (await res.json()) as {
        reply?: string;
        proposedReorderProductId?: string;
        proposedReorderQty?: number;
        error?: string;
      };

      if (!res.ok || !data.reply) {
        const errMsg: ChatMessage = {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content:
            data.error ||
            'Gemini API request failed. Verify GEMINI_API_KEY in Settings > Secrets.',
          timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
          isError: true,
        };
        setMessages((prev) => [...prev, errMsg]);
        return;
      }

      let proposedAction: ChatProposedAction | undefined;
      if (data.proposedReorderProductId && data.proposedReorderQty && data.proposedReorderQty > 0) {
        const product = products.find((p) => p.id === data.proposedReorderProductId);
        if (product) {
          const supplier = suppliers.find((s) => s.id === product.supplierId);
          proposedAction = {
            kind: 'create_po',
            label: `Create PO for ${data.proposedReorderQty}× ${product.name}`,
            productId: product.id,
            productName: product.name,
            supplierId: product.supplierId,
            supplierName: supplier?.companyName ?? 'Primary Supplier',
            quantity: data.proposedReorderQty,
            estimatedCost: Number((data.proposedReorderQty * product.unitCost).toFixed(2)),
          };
        }
      }

      const botMsg: ChatMessage = {
        id: `bot-${Date.now()}`,
        role: 'assistant',
        content: data.reply,
        timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        isGuidanceOnly: true,
        proposedAction,
      };
      setMessages((prev) => [...prev, botMsg]);
    } catch {
      const errMsg: ChatMessage = {
        id: `err-${Date.now()}`,
        role: 'assistant',
        content: 'Network error reaching the Gemini chat server endpoint.',
        timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        isError: true,
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void askQuestion(input);
  };

  const handleConfirmAction = (messageId: string, action: ChatProposedAction) => {
    onConfirmProposedAction(action);
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId && m.proposedAction
          ? {
              ...m,
              proposedAction: { ...m.proposedAction, confirmed: true },
            }
          : m
      )
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/35 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="chatbot-title"
    >
      <div className="bg-white w-full max-w-md h-full border-l border-slate-200 shadow-2xl flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center">
              <Bot className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h2 id="chatbot-title" className="font-display text-base font-bold text-slate-900">
                Inventory Assistant
              </h2>
              <p className="text-xs text-slate-500">
                Gemini AI · Read-only until confirmed
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close inventory chatbot"
            className="p-2 text-slate-400 hover:text-slate-700 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Suggested Chips */}
        <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/70">
          <p className="text-[11px] font-medium text-slate-500 mb-2">Suggested questions</p>
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTED_QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                disabled={isTyping}
                onClick={() => void askQuestion(q)}
                className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:border-orange-400 hover:text-orange-700 disabled:opacity-50 rounded-lg transition-colors text-left"
              >
                {q}
              </button>
            ))}
          </div>
        </div>

        {/* Message List */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {messages.map((msg) => {
            const isUser = msg.role === 'user';
            return (
              <div
                key={msg.id}
                className={`flex gap-2.5 ${isUser ? 'justify-end' : 'justify-start'}`}
              >
                {!isUser && (
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                      msg.isError ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {msg.isError ? (
                      <AlertCircle className="w-4 h-4" aria-hidden="true" />
                    ) : (
                      <Bot className="w-4 h-4" aria-hidden="true" />
                    )}
                  </div>
                )}

                <div className={`max-w-[85%] space-y-2 ${isUser ? 'items-end' : 'items-start'}`}>
                  <div
                    className={`rounded-xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-line ${
                      isUser
                        ? 'bg-slate-900 text-white'
                        : msg.isError
                        ? 'bg-red-50 border border-red-200 text-red-800'
                        : 'bg-slate-50 border border-slate-200 text-slate-800'
                    }`}
                  >
                    {msg.content}
                  </div>

                  {!isUser && msg.isGuidanceOnly && !msg.isError && (
                    <p className="text-[11px] text-slate-400 flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3" aria-hidden="true" />
                      <span>Gemini AI guidance over displayed data · {msg.timestamp}</span>
                    </p>
                  )}

                  {msg.proposedAction && (
                    <div className="p-3 rounded-xl border border-orange-200 bg-orange-50/60 space-y-2">
                      <p className="text-xs font-semibold text-slate-900">
                        Optional Action (Requires Confirmation)
                      </p>
                      <p className="text-xs text-slate-700">
                        Draft PO: {msg.proposedAction.quantity}× {msg.proposedAction.productName}{' '}
                        from {msg.proposedAction.supplierName} (Est.{' '}
                        {formatCurrency(msg.proposedAction.estimatedCost)})
                      </p>
                      {msg.proposedAction.confirmed ? (
                        <p className="text-xs font-semibold text-emerald-700 inline-flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Confirmed & added to Purchase Orders</span>
                        </p>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleConfirmAction(msg.id, msg.proposedAction!)}
                          className="px-3 py-1.5 text-xs font-semibold text-white bg-orange-600 hover:bg-orange-700 rounded-lg transition-colors"
                        >
                          Confirm & Create Purchase Order
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {isUser && (
                  <div className="w-7 h-7 rounded-lg bg-orange-100 text-orange-700 flex items-center justify-center shrink-0 mt-0.5">
                    <User className="w-4 h-4" aria-hidden="true" />
                  </div>
                )}
              </div>
            );
          })}

          {isTyping && (
            <div className="flex items-center gap-2.5 text-xs text-slate-500">
              <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center">
                <Bot className="w-4 h-4 text-slate-500" aria-hidden="true" />
              </div>
              <span className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl">
                Asking Gemini about your inventory...
              </span>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input Form */}
        <form onSubmit={handleSubmit} className="p-4 border-t border-slate-200 bg-white">
          <div className="flex items-center gap-2">
            <input
              type="text"
              aria-label="Ask inventory assistant"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about stock value, reorders, or trends..."
              className="flex-1 px-3.5 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-600"
            />
            <button
              type="submit"
              disabled={!input.trim() || isTyping}
              aria-label="Send question"
              className="p-2.5 bg-orange-600 hover:bg-orange-700 disabled:bg-slate-300 text-white rounded-lg transition-colors"
            >
              <Send className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
