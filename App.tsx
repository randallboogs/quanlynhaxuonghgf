import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { 
  Calendar, CheckSquare, Layout, Filter, Plus, Search, ChevronRight, 
  ChevronDown, AlertCircle, X, Save, Trash2, 
  UploadCloud, Loader2, RefreshCw, AlertTriangle, 
  Zap, Package, Layers, List, Edit3, ArrowUpDown, 
  ZoomIn, ZoomOut, ChevronLeft, CalendarDays, Eye, EyeOff, 
  Info, Clock, CheckCircle2, ListTodo, Flame, 
  Maximize2, ArrowRight, ArrowLeft, ArrowUpRight, ArrowDownRight,
  UserCircle2, BoxSelect, ChartBar, Kanban, MapPin, Hash, Phone, 
  StickyNote, ArchiveRestore, Network, Circle, Clock4, Link2, 
  CalendarClock, CloudCog, FolderKanban, Banknote, Check, Box, Tag, Hammer, Truck, Factory, Component,
  FileCheck, Monitor, User, Calculator, FileInput, ShoppingCart, FileText, AlarmClock, MoreHorizontal,
  Settings
} from 'lucide-react';
import * as firebaseAuth from "firebase/auth";
import { collection, query, onSnapshot } from "firebase/firestore";

// Services
import { auth, db } from './services/firebase';
import { fetchTrackerData, updateTracker, addTracker, deleteTracker, updateProjectInfo } from './services/sheety';

// Constants & Types
import { STAGES, SMART_TAGS, STANDARD_TASKS, TASK_COLUMNS, DEFAULT_SHEET_URL, MASTER_DATA, WORKFLOW_STEPS, WORKER_LIST, TECH_LIST, PRODUCT_TYPES, MATERIAL_PROVIDERS, OTHER_SUPPLIES } from './constants';
import { ProductionItem, Tag as TagType, GroupedOrder, StatData } from './types';

// Utils
import { 
  calculateConstructionTime, calculateDate, addDays, getCNCDuration, runAutoSchedule, 
  mapStageFromText, getNextStep, formatDateForSheet, parseSheetDate, toShortDate 
} from './src/utils/helpers';

// Components
import { ToastContainer, Logo3D, Modal, StatCard, ToastMsg } from './src/components/common/UIComponents';
import { ProjectView } from './src/features/ProjectView';
import { KanbanView } from './src/features/KanbanView';
import { GanttView } from './src/features/GanttView';
import { ListView } from './src/features/ListView';
import { CalendarView } from './src/features/CalendarView';

export function App() {
  const [user, setUser] = useState<firebaseAuth.User | null>(null);
  const [items, setItems] = useState<ProductionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'kanban' | 'gantt' | 'calendar' | 'project'>('project');
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [filterUrgent, setFilterUrgent] = useState(false);
  const [filterOverdue, setFilterOverdue] = useState(false);
  const [filterCompleted, setFilterCompleted] = useState(false);
  
  const [dateFilter, setDateFilter] = useState<string>('all');
  const [isDateFilterOpen, setIsDateFilterOpen] = useState(false);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ProductionItem | null>(null);
  const [formTasks, setFormTasks] = useState<Partial<ProductionItem>[]>([]);
  const [dirtyTaskIndices, setDirtyTaskIndices] = useState<Set<number>>(new Set());

  const [isOffline, setIsOffline] = useState(true);
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [visibleColumns, setVisibleColumns] = useState({ project: true, task: true, stage: true, progress: true, deadline: true, actions: true });
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);

  // --- STATE LƯU MASTER DATA TỰ ĐỘNG ---
  const [masterData, setMasterData] = useState({
      techTeam: [],    // KĨ THUẬT (Col D)
      materials: [],   // VÁN (Col E)
      workers: [],     // THỢ (Col G)
      routes: [],      // TUYẾN GIAO (Col H)
      productTypes: [] // PHÂN LOẠI (Col I)
  });

  const addToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => removeToast(id), 4000);
  };
  const removeToast = (id: number) => setToasts(prev => prev.filter(t => t.id !== id));
  const handleSort = (key: string) => { setSortConfig(current => (current?.key === key && current.direction === 'asc') ? { key, direction: 'desc' } : { key, direction: 'asc' }); };

  const getDateRange = (filter: string): { start: Date, end: Date } | null => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    switch (filter) {
      case 'today': return { start: todayStart, end: todayEnd };
      case 'tomorrow': { const s = new Date(todayStart); s.setDate(s.getDate() + 1); const e = new Date(todayEnd); e.setDate(e.getDate() + 1); return { start: s, end: e }; }
      case 'this_week': { 
        const currentDay = now.getDay(); 
        const distanceToMonday = currentDay === 0 ? 6 : currentDay - 1;
        const s = new Date(now); s.setDate(now.getDate() - distanceToMonday); s.setHours(0, 0, 0, 0);
        const e = new Date(s); e.setDate(s.getDate() + 6); e.setHours(23, 59, 59, 999);
        return { start: s, end: e }; 
      }
      default: return null;
    }
  };

  // --- 1. LOAD DATA ---
  useEffect(() => {
    setLoading(true);
    const unsubscribeAuth = firebaseAuth.onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        setIsOffline(false);
        const q = query(collection(db, 'production_items'));
        const unsubscribeSnapshot = onSnapshot(q, (snapshot) => {
           const loadedItems = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProductionItem));
           setItems(loadedItems);
           setLoading(false);
        }, (error) => { setIsOffline(true); setLoading(false); });
        return () => unsubscribeSnapshot();
      } else {
        setIsOffline(true); setLoading(false);
      }
    });
    return () => unsubscribeAuth();
  }, []);

  const handleLoadData = async () => {
    setLoading(true);
    try {
      const data = await fetchTrackerData();
      console.log("Dữ liệu thô từ Sheet:", data[0]); 

      if (Array.isArray(data)) {
        const parsedItems = data.map((task: any) => {
          if (!task['MADON'] && !task['Ma don'] && !task['Mã Đơn']) return null;

          const getVal = (keys: string[]) => {
             for (const k of keys) {
                 if (task[k] !== undefined) return task[k];
             }
             return ''; 
          };

          return {
            id: `stein_${getVal(['MADON', 'Ma don', 'Mã Đơn'])}`,       
            sheetyId: getVal(['MADON', 'Ma don', 'Mã Đơn']), 
            
            title: getVal(['MADON', 'Ma don']),
            client: getVal(['KHACHHANG', 'Khach hang', 'KHACH HANG', 'KH', 'Tenkhach']), 
            value: parseInt(String(getVal(['TIEN', 'Tien', 'Doanh so', 'Doanhso'])).replace(/\D/g, '')) * 1000000 || 0,
            
            boardProvider: getVal(['VAN', 'Van', 'van', 'Nha Cung Cap', 'NCC']),      
            
            productType: getVal(['PHAN-LOAI', 'Phan loai', 'Phanloai']),
            taskName: getVal(['TT DON HANG', 'Trang thai', 'Status', 'status']) || 'Công việc mới',     
            status: getVal(['TT DON HANG', 'Trang thai', 'Status', 'status'])?.includes('3.') ? 'done' : 'in_progress', 
            stage: mapStageFromText(getVal(['TT DON HANG', 'Trang thai', 'Status'])),
            progress: getVal(['TT DON HANG', 'Trang thai', 'Status'])?.includes('3.') ? 100 : 50,

            deliveryDate: parseSheetDate(getVal(['NGAY-GIAO', 'Ngay giao'])), 
            duration: parseInt(getVal(['TIME', 'Time', 'Thoi gian', 'Duration'])) || 3,
            startDate: parseSheetDate(getVal(['NGAY-NHAN-FILE', 'Started'])),
            
            assignee: getVal(['CNC', 'Ky thuat', 'Nguoilam']),           
            fileDate: parseSheetDate(getVal(['NGAY-NHAN-FILE', 'Ngay nhan file'])),
            
            otherSupply: getVal(['VAT-TU-NGOAI', 'Vat tu phu']), 
            materialOrderDate: parseSheetDate(getVal(['NGAY-DAT-HANG', 'Ngay dat van'])), 
            
            worker: getVal(['THO-CHINH', 'Tho chinh', 'thophutrach']),       
            pickingDate: parseSheetDate(getVal(['SOAN-HANG', 'Soan hang'])),  
            deliveryRoute: getVal(['TUYEN GIAO', 'Tuyen giao', 'TUYEN-GIAO']), 
            note: getVal(['GHICHU', 'Ghi chu']),
            clientPhone: getVal(['SDT']),
            priority: 'Medium',
            tags: [],
            skipped: false,
            dependencies: [],
            createdAt: Date.now()            
          };
        }).filter(Boolean);

        setItems(parsedItems as ProductionItem[]);
      }
    } catch (error) {
      console.error(error);
      addToast("Lỗi tải dữ liệu!", 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleManualRefresh = () => handleLoadData();

  const visibleItems = useMemo(() => {
    return items.filter(i => {
      if (!i.title || i.title === 'Chưa đặt tên') return false;
      if (i.skipped) return false;
      if (dateFilter !== 'all') {
          const range = getDateRange(dateFilter);
          if (range) {
             const start = new Date(i.startDate); start.setHours(0,0,0,0);
             const end = new Date(addDays(i.startDate, i.duration)); end.setHours(23,59,59,999);
             if (!(start <= range.end && end >= range.start)) return false;
          }
      }
      if (searchQuery && !((i.title+i.client+i.taskName).toLowerCase().includes(searchQuery.toLowerCase()))) return false;
      if (filterCompleted && !(i.progress === 100 || i.status === 'done')) return false;
      if (filterUrgent && !i.isUrgent) return false;
      if (filterOverdue && (i.progress >= 100 || addDays(i.startDate, i.duration) >= new Date().toISOString().split('T')[0])) return false;
      return true;
    }).sort((a, b) => {
       if (sortConfig?.key === 'deadline') {
           const d1 = new Date(addDays(a.startDate, a.duration)).getTime(), d2 = new Date(addDays(b.startDate, b.duration)).getTime();
           return sortConfig.direction === 'asc' ? d1 - d2 : d2 - d1;
       }
       return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }, [items, searchQuery, filterUrgent, filterOverdue, filterCompleted, sortConfig, dateFilter]);

  const groupedItems = useMemo(() => {
    const groups: Record<string, GroupedOrder> = {};
    visibleItems.forEach(item => {
      const groupKey = (item.title || "Chưa đặt tên").trim().toUpperCase();
      if (!groups[groupKey]) groups[groupKey] = { id: groupKey, title: item.title, client: item.client, items: [], minStart: item.startDate, maxEnd: addDays(item.startDate, item.duration), totalProgress: 0 };
      groups[groupKey].items.push(item);
      const end = addDays(item.startDate, item.duration);
      if (item.startDate < groups[groupKey].minStart) groups[groupKey].minStart = item.startDate;
      if (end > groups[groupKey].maxEnd) groups[groupKey].maxEnd = end;
      groups[groupKey].totalProgress += item.progress;
    });
    return Object.values(groups);
  }, [visibleItems]);

  const stats: StatData = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    return {
      total: visibleItems.length,
      completed: visibleItems.filter(i => i.progress === 100).length,
      overdue: visibleItems.filter(i => i.progress < 100 && addDays(i.startDate, i.duration) < today).length,
      active: visibleItems.length - visibleItems.filter(i => i.progress === 100).length,
      warning: visibleItems.filter(i => i.progress < 100 && addDays(i.startDate, i.duration) >= today && addDays(i.startDate, i.duration) <= addDays(today, 3)).length
    };
  }, [visibleItems]);

  const handleUpdateStatus = async (item: ProductionItem) => {
     const currentStatusText = item.taskName || '';
     const nextStatusText = getNextStep(currentStatusText);
     const totalSteps = WORKFLOW_STEPS.length;
     const nextIndex = WORKFLOW_STEPS.indexOf(nextStatusText);
     const newProgress = Math.round(((nextIndex + 1) / totalSteps) * 100);

     let internalStatus: string = 'in_progress';
     if (nextStatusText.includes('3.2')) internalStatus = 'done';
     else if (nextStatusText.includes('1.1')) internalStatus = 'todo';

     const newItem = { 
         ...item, 
         taskName: nextStatusText, 
         status: internalStatus,
         progress: newProgress,
         stage: mapStageFromText(nextStatusText)
     };

     setItems(prev => prev.map(i => i.id === item.id ? newItem : i));

     if (newItem.sheetyId) {
         try {
             // Mapping Key Update Nhanh
             await updateTracker(newItem.sheetyId, {
                 'TT DON HANG': nextStatusText, 
                 'MADON': newItem.title
             });
             addToast(`Đã chuyển sang: ${nextStatusText}`, 'success');
         } catch(e) {
             console.error("Lỗi cập nhật nhanh:", e);
         }
     }
  };

  const handleSaveNote = async (item: ProductionItem) => {
      if (!item.sheetyId) return;
      try {
          await updateTracker(item.sheetyId, {
              'GHICHU': item.note, 
              'MADON': item.title
          });
          addToast("Đã lưu ghi chú", 'success');
      } catch (error) {
          console.error("Lỗi lưu ghi chú:", error);
          addToast("Không thể lưu ghi chú", 'error');
      }
  };

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;
    setLoading(true);

    try {
        // CẤU TRÚC GỬI LÊN SHEET (Phải khớp 100% với tên cột Sheet mới)
        const sheetPayload = {
            'MADON': editingItem.title,
            'KH': editingItem.client,
            'TIEN': (editingItem.value || 0) / 1000000, // Lưu số nhỏ (54)
            'PHAN-LOAI': editingItem.productType,
            'TT DON HANG': editingItem.status || editingItem.taskName, // Status text
            
            'VAN': editingItem.boardProvider,        // Col F (Updated)
            // NGAY-GIAO ưu tiên giá trị tự tính (deliveryDate) nếu có
            'NGAY-GIAO': formatDateForSheet(editingItem.deliveryDate), 
            'TIME': editingItem.duration,       // Col H (Updated)
            
            'CNC': editingItem.assignee,        // Col I (Updated)
            'NGAY-NHAN-FILE': formatDateForSheet(editingItem.fileDate), // Col J (Updated)
            'NGAY-DAT-HANG': formatDateForSheet(editingItem.materialOrderDate), // Col L (Updated)
            'THO-CHINH': editingItem.worker,    // Col M (Updated)
            'SOAN-HANG': formatDateForSheet(editingItem.pickingDate), // Col N (Updated)
            'TUYEN-GIAO': editingItem.deliveryRoute,   // Col O (Updated)
            'GHICHU': editingItem.note,         // Col P (Updated)
            'SDT': editingItem.clientPhone,      // Col R (Optional)
            'VAT-TU-NGOAI': editingItem.otherSupply
        };

        if (items.some(i => i.sheetyId === editingItem.title)) {
             await updateTracker(editingItem.title, sheetPayload);
        } else {
             await addTracker(sheetPayload);
        }

        await handleLoadData(); // Reload để cập nhật Master Data mới
        setIsModalOpen(false);
        setEditingItem(null);
    } catch (error) {
        console.error("Save Error:", error);
        addToast("Lỗi khi lưu dữ liệu.", 'error');
    } finally {
        setLoading(false);
    }
  };

  const handleMoveTask = async (itemId: string, updates: Partial<ProductionItem>) => {
      setItems(prev => prev.map(i => i.id === itemId ? { ...i, ...updates } : i));
  };

  const updateTaskField = useCallback((index: number, field: keyof ProductionItem, value: any) => {
      setFormTasks(prev => { const n = [...prev]; n[index] = { ...n[index], [field]: value }; return n; });
      setDirtyTaskIndices(prev => new Set(prev).add(index));
  }, []);

  const handleDeleteItem = useCallback(async (id: string) => {
     if (!window.confirm("Xóa công việc này?")) return;
     const itemToDelete = items.find(i => String(i.id) === String(id));
     setDeletingIds(prev => new Set(prev).add(id));
     if (!isOffline && itemToDelete?.title) try { await deleteTracker(itemToDelete.title); } catch (e) { console.error(e); }
     setItems(prev => prev.filter(i => String(i.id) !== String(id)));
     setDeletingIds(prev => { const n = new Set(prev); n.delete(id); return n; });
     addToast("Đã xóa.", 'success');
  }, [items, isOffline]);

  const handleToggleUrgent = (item: ProductionItem) => {
     const newItem = { ...item, isUrgent: !item.isUrgent };
     setItems(prev => prev.map(i => i.id === item.id ? newItem : i));
  };

  const openCreateModal = () => {
      const today = new Date().toISOString().split('T')[0];
      setEditingItem({ id: '', title: '', client: '', value: 0, createdAt: Date.now(), priority: 'Medium', progress: 0, taskName: 'Dự án mới', status: '1.1 Cọc khảo sát', productType: 'Hàng lẻ đặt', stage: 'design', startDate: today, duration: 3, tags: [], note: '', dependencies: [], materialOrderDate: '', fileDate: '', deliveryDate: '', pickingDate: '' } as ProductionItem);
      setIsModalOpen(true);
  };

  const handleEdit = (item: any) => {
    setEditingItem({
        ...item,
        value: item.value || 0,
        duration: item.duration || 0,
        materialOrderDate: item.materialOrderDate || '',
        fileDate: item.fileDate || '',
        deliveryDate: item.deliveryDate || '',
        pickingDate: item.pickingDate || ''
    });
    setIsModalOpen(true);
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-800 selection:bg-indigo-100">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-40 h-16 px-6 flex items-center justify-between shadow-sm backdrop-blur-xl bg-white/90">
        <div className="max-w-[1920px] mx-auto px-4 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6 shrink-0">
            <div className="flex items-center gap-3"><Logo3D /><div className="hidden 2xl:block"><h1 className="text-lg font-black text-slate-900 tracking-tight leading-none">Quản Lý Xưởng</h1><p className="text-[10px] text-slate-400 font-bold tracking-widest uppercase mt-0.5">Project by Wining</p></div></div>
            <div className="flex bg-slate-100/80 p-1 rounded-xl hidden lg:flex border border-slate-200/50">
              {[{ id: 'project', icon: FolderKanban, label: 'Dự án' }, { id: 'gantt', icon: ChartBar, label: 'Gantt' }, { id: 'kanban', icon: Kanban, label: 'Kanban' }, { id: 'calendar', icon: CalendarDays, label: 'Lịch' }, { id: 'list', icon: ListTodo, label: 'D.Sách' }].map(tab => (
                 <button key={tab.id} onClick={() => setViewMode(tab.id as any)} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${viewMode === tab.id ? 'bg-white text-indigo-600 border-slate-200 shadow-[0_1px_2px_rgba(0,0,0,0.05),inset_0_-1px_0_rgba(0,0,0,0.05)]' : 'border-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-700'}`}><tab.icon size={14} strokeWidth={2.5} /><span>{tab.label}</span></button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3 ml-auto">
             <div className="relative z-30">
                <button onClick={() => setIsDateFilterOpen(!isDateFilterOpen)} className={`flex items-center gap-2 px-3 py-1.5 text-xs font-bold rounded-lg border transition-all h-10 ${dateFilter !== 'all' ? 'bg-indigo-50 text-indigo-700 border-indigo-200 shadow-sm' : 'bg-white border-slate-200 text-slate-600 shadow-[0_1px_2px_rgba(0,0,0,0.05)] hover:bg-slate-50'}`}><CalendarClock size={14} /><span>{dateFilter === 'all' ? 'Thời gian' : dateFilter}</span><ChevronDown size={12} /></button>
                {isDateFilterOpen && (
                    <>
                        <div className="fixed inset-0 z-10" onClick={() => setIsDateFilterOpen(false)}></div>
                        <div className="absolute top-full left-0 mt-2 w-48 bg-white border border-slate-100 rounded-xl shadow-xl z-40 p-1 grid gap-0.5 animate-in fade-in zoom-in-95">
                            {['all', 'today', 'tomorrow', 'this_week'].map(f => (
                                <button key={f} onClick={() => { setDateFilter(f); setIsDateFilterOpen(false); }} className="w-full text-left px-3 py-2 text-xs font-bold rounded-lg hover:bg-slate-50 text-slate-600 capitalize">{f.replace('_', ' ')}</button>
                            ))}
                        </div>
                    </>
                )}
             </div>
             <div className="flex items-center bg-white border border-slate-200 rounded-xl p-1 shadow-sm mr-2 h-10">
                <button onClick={() => setIsFocusMode(!isFocusMode)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${isFocusMode ? 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white shadow-lg shadow-indigo-500/30 border-transparent' : 'text-slate-500 hover:bg-slate-50 border-transparent'}`}><Zap size={14} className={isFocusMode ? 'fill-white animate-pulse' : ''} /><span>Focus</span></button>
                <div className="w-px h-4 bg-slate-200 mx-1"></div>
                <button onClick={() => setFilterUrgent(!filterUrgent)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${filterUrgent ? 'bg-gradient-to-r from-red-500 to-orange-500 text-white shadow-lg shadow-red-500/30 border-transparent' : 'text-slate-500 hover:bg-slate-50'}`}><Flame size={14} className={filterUrgent ? 'fill-white' : ''} /><span>Gấp</span></button>
                <button onClick={() => setFilterCompleted(!filterCompleted)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${filterCompleted ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-lg shadow-emerald-500/30 border-transparent' : 'text-slate-500 hover:bg-slate-50'}`}>{filterCompleted ? <Eye size={14} /> : <EyeOff size={14} />}<span>Xong</span></button>
             </div>
             <div className="relative group hidden xl:block ml-2"><input type="text" placeholder="Tìm kiếm..." className="pl-9 pr-8 py-1.5 bg-slate-100 border border-transparent rounded-lg text-sm font-medium text-slate-700 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-100 focus:border-indigo-200 transition-all w-48 focus:w-64" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} /><Search size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-500" />{searchQuery && <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X size={14} /></button>}</div>
             <div className="flex items-center gap-1 ml-2">
                 <button onClick={handleLoadData} className={`p-2 rounded-xl border border-slate-200 bg-white text-slate-500 shadow-[0_1px_2px_rgba(0,0,0,0.05)] hover:bg-slate-50 hover:text-indigo-600 active:bg-slate-100 transition-all ${loading ? 'animate-pulse' : ''}`} title="Sync Sheety"><CloudCog size={20} strokeWidth={2} /></button>
                 <button onClick={handleManualRefresh} className={`p-2 rounded-xl border border-slate-200 bg-white text-slate-500 shadow-[0_1px_2px_rgba(0,0,0,0.05)] hover:bg-slate-50 hover:text-indigo-600 active:bg-slate-100 transition-all ml-2 ${loading ? 'animate-spin text-indigo-600 bg-indigo-50' : ''}`} title="Cập nhật dữ liệu" disabled={loading}><RefreshCw size={20} strokeWidth={2} /></button>
                 <button onClick={() => openCreateModal()} className="bg-gradient-to-b from-indigo-500 to-indigo-600 text-white p-2 rounded-xl shadow-[0_2px_4px_rgba(79,70,229,0.3),inset_0_1px_0_rgba(255,255,255,0.2)] border border-indigo-700 hover:from-indigo-400 hover:to-indigo-500 active:from-indigo-600 active:to-indigo-700 active:shadow-inner transition-all flex items-center justify-center aspect-square ml-2"><Plus size={20} strokeWidth={3} /></button>
             </div>
          </div>
        </div>
      </header>

      <main className="max-w-[1920px] mx-auto p-6 h-[calc(100vh-64px)] flex flex-col gap-6">
        {viewMode !== 'project' && (<div className={`grid grid-cols-4 gap-6 transition-all duration-500 ${isFocusMode ? 'opacity-20 blur-[1px] pointer-events-none grayscale' : 'opacity-100'}`}><StatCard title="TỔNG VIỆC" value={stats.total} icon={Layers} color="text-indigo-600" subColor="bg-indigo-500" /><StatCard title="QUÁ HẠN" value={stats.overdue} icon={AlertCircle} color="text-red-600" subColor="bg-red-500" /><StatCard title="SẮP ĐẾN HẠN" value={stats.warning} icon={Clock} color="text-amber-600" subColor="bg-amber-500" /><StatCard title="HOÀN THÀNH" value={stats.completed} icon={CheckSquare} color="text-emerald-600" subColor="bg-emerald-500" /></div>)}

        <div className="flex-1 min-h-0">
          {loading ? (<div className="h-full flex flex-col items-center justify-center text-slate-400"><Loader2 size={48} className="animate-spin mb-4 text-indigo-500" /><p className="font-medium animate-pulse">Đang đồng bộ dữ liệu...</p></div>) : (
            <>
              {viewMode === 'project' && <ProjectView items={visibleItems} onEdit={handleEdit} onAdd={openCreateModal} onDelete={handleDeleteItem} deletingIds={deletingIds} isFocusMode={isFocusMode} onQuickUpdate={handleUpdateStatus} />}
              {viewMode === 'gantt' && <GanttView groupedItems={groupedItems} />}
              {viewMode === 'kanban' && <KanbanView items={visibleItems} onEdit={handleEdit} onToggleUrgent={handleToggleUrgent} onUpdateStatus={handleUpdateStatus} onDelete={handleDeleteItem} deletingIds={deletingIds} isFocusMode={isFocusMode} onMoveTask={handleMoveTask} onSaveNote={handleSaveNote} />}
              {viewMode === 'list' && <ListView items={visibleItems} onEdit={handleEdit} onDelete={handleDeleteItem} onToggleUrgent={handleToggleUrgent} onUpdateStatus={handleUpdateStatus} visibleColumns={visibleColumns} onSort={handleSort} sortConfig={sortConfig} deletingIds={deletingIds} isFocusMode={isFocusMode} />}
              {viewMode === 'calendar' && <CalendarView items={visibleItems} onEdit={handleEdit} />}
            </>
          )}
        </div>
      </main>
      
      {/* --- MODAL CHỈNH SỬA & TẠO MỚI (GIAO DIỆN PRO) --- */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
        {!editingItem ? (
            <div className="h-full flex items-center justify-center"><Loader2 className="animate-spin text-indigo-600" size={32}/></div>
        ) : (
        <form onSubmit={handleSaveItem} className="flex flex-col h-full bg-[#F8FAFC]">
           {/* 1. HEADER: Tiêu đề & Nút tắt */}
           <div className="px-8 py-5 border-b border-slate-200 bg-white sticky top-0 z-40 flex justify-between items-center shadow-sm shrink-0">
              <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-indigo-600 text-white rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-200 transform rotate-3">
                      <Calculator size={24} />
                  </div>
                  <div>
                      <h2 className="text-xl font-black text-slate-800 tracking-tight">{editingItem.id ? `Chỉnh sửa: ${editingItem.title}` : 'Tạo Đơn Mới'}</h2>
                      <div className="text-xs font-bold text-slate-400 mt-1 flex items-center gap-2">
                          <span className="bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded border border-indigo-100">Công thức: /40 + 1</span>
                          {editingItem.taskName && <span className="bg-slate-100 px-2 py-0.5 rounded text-slate-600">{editingItem.taskName}</span>}
                      </div>
                  </div>
              </div>
              <button type="button" onClick={() => setIsModalOpen(false)} className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition-all"><X size={20}/></button>
           </div>

           {/* 2. BODY: Nội dung chính (Scrollable) */}
           <div className="flex-1 overflow-y-auto p-8 min-h-0 custom-scrollbar">
              <div className="grid grid-cols-1 gap-8 max-w-5xl mx-auto">
                  
                  {/* A. THANH TRẠNG THÁI (Mindmap) */}
                  <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4 overflow-x-auto">
                      <div className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase shrink-0"><Network size={16}/> Luồng:</div>
                      <div className="flex items-center gap-3 text-[10px] font-bold text-slate-500 whitespace-nowrap">
                          <span className="bg-emerald-50 text-emerald-600 px-3 py-1.5 rounded-lg border border-emerald-100 shadow-sm">TIỀN ({new Intl.NumberFormat('vi-VN', { notation: "compact" }).format(editingItem.value || 0)})</span><ArrowRight size={12}/>
                          <span className="bg-indigo-50 text-indigo-600 px-3 py-1.5 rounded-lg border border-indigo-100 shadow-sm">TIME ({editingItem.duration}d)</span><ArrowRight size={12}/>
                          <span className="bg-blue-50 text-blue-600 px-3 py-1.5 rounded-lg border border-blue-100 shadow-sm">CNC ({getCNCDuration(editingItem.fileDate || '', editingItem.materialOrderDate || '')}d)</span><ArrowRight size={12}/>
                          <span className="bg-purple-50 text-purple-600 px-3 py-1.5 rounded-lg border border-purple-100 shadow-sm">VÁN ({editingItem.boardProvider ? 'Đã chọn' : '?'})</span><ArrowRight size={12}/>
                          <span className="bg-slate-800 text-white px-3 py-1.5 rounded-lg shadow-sm">NGHIỆM THU ({editingItem.deliveryDate ? toShortDate(calculateDate(editingItem.deliveryDate, editingItem.duration)) : '?'})</span>
                      </div>
                  </div>

                  {/* B. KHU VỰC TÍNH TOÁN (Tiền -> Thời gian) */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="md:col-span-2 bg-white p-6 rounded-3xl shadow-sm border border-slate-100 relative overflow-hidden group hover:border-indigo-200 transition-colors">
                          <label className="text-xs font-bold text-slate-400 uppercase mb-3 block">Nhập Doanh Số (Col C)</label>
                          <div className="relative flex items-center">
                              <span className="text-3xl font-black text-slate-300 absolute left-4">₫</span>
                              <input type="text" className="w-full bg-slate-50 border-2 border-transparent focus:bg-white focus:border-indigo-500 rounded-2xl py-4 pl-12 pr-4 text-3xl font-black text-slate-800 outline-none transition-all placeholder-slate-200" 
                                  placeholder="0" value={editingItem.value ? new Intl.NumberFormat('vi-VN').format(editingItem.value) : ''} 
                                  onChange={e => {
                                      const val = parseInt(e.target.value.replace(/\D/g, '')) || 0;
                                      const time = calculateConstructionTime(val); 
                                      // Tự động tính lại lịch khi đổi tiền (thay đổi thời gian thi công)
                                      const calc = runAutoSchedule(editingItem.materialOrderDate || '', editingItem.boardProvider || '');
                                      setEditingItem(p => p ? { ...p, value: val, duration: time } : null);
                                  }} />
                          </div>
                      </div>
                      <div className="bg-gradient-to-br from-indigo-600 to-blue-600 p-6 rounded-3xl text-white flex flex-col justify-center items-center shadow-lg relative overflow-hidden">
                          <div className="absolute top-0 bg-white/20 px-3 py-1 rounded-b-xl text-[10px] font-bold backdrop-blur-sm">AUTO CALC</div>
                          <div className="text-5xl font-black mb-1 flex items-baseline gap-1 mt-2">{editingItem.duration || 0}<span className="text-lg font-bold text-indigo-200">ngày</span></div>
                          <div className="text-[11px] font-bold text-indigo-100 bg-white/10 px-3 py-1 rounded-full border border-white/20">( {editingItem.value ? (editingItem.value / 1000000).toFixed(0) : 0} tr / 40 + 1 )</div>
                      </div>
                  </div>

                  {/* C. LỊCH BIỂU CHI TIẾT (3 CỘT) */}
                  <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm grid grid-cols-1 lg:grid-cols-3 gap-6 relative">
                      {/* Cột 1: CNC */}
                      <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-4 hover:bg-white hover:shadow-md transition-all">
                          <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                              <span className="text-[10px] font-black text-slate-500 uppercase bg-white px-2 py-1 rounded border">BƯỚC 1: CNC</span>
                              <span className="text-[10px] font-bold text-blue-600">TG: {getCNCDuration(editingItem.fileDate || '', editingItem.materialOrderDate || '')} ngày</span>
                          </div>
                          <div><label className="text-[10px] font-bold text-slate-400 block mb-1">Ngày Nhận File (Rule 1)</label><input type="date" className="w-full bg-white border border-slate-300 rounded-xl p-2.5 text-sm font-bold outline-none focus:border-blue-500 transition-colors" value={editingItem.fileDate || ''} onChange={e => setEditingItem(p => p ? {...p, fileDate: e.target.value} : null)} /></div>
                          <div><label className="text-[10px] font-bold text-slate-400 block mb-1">Kỹ thuật</label><select className="w-full bg-white border border-slate-300 rounded-xl p-2.5 text-sm font-bold outline-none focus:border-blue-500" value={editingItem.assignee || ''} onChange={e => setEditingItem(p => p ? {...p, assignee: e.target.value} : null)}><option value="">-- Chọn --</option>{TECH_LIST.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
                      </div>

                      {/* Cột 2: VẬT TƯ (Multi-select Ván) */}
                      <div className="p-4 bg-purple-50 rounded-2xl border border-purple-100 space-y-4 hover:bg-white hover:border-purple-200 hover:shadow-md transition-all">
                          <div className="flex justify-between items-center pb-2 border-b border-purple-200">
                              <span className="text-[10px] font-black text-purple-600 uppercase bg-white px-2 py-1 rounded border border-purple-100">BƯỚC 2: VẬT TƯ</span>
                          </div>
                          <div><label className="text-[10px] font-bold text-purple-400 block mb-1">Ngày Đặt Ván (Rule 2)</label><input type="date" className="w-full bg-white border border-purple-200 rounded-xl p-2.5 text-sm font-bold text-purple-900 outline-none focus:border-purple-500 transition-colors" value={editingItem.materialOrderDate || ''} onChange={e => { const d = e.target.value; const c = runAutoSchedule(d, editingItem.boardProvider || ''); setEditingItem(p => p ? {...p, materialOrderDate: d, pickingDate: c.pickingDate} : null); }} /></div>
                          
                          {/* Chọn nhiều NCC Ván */}
                          <div><label className="text-[10px] font-bold text-purple-400 block mb-1">Nhà Cung Cấp (Chọn nhiều)</label>
                              <div className="flex flex-wrap gap-1.5">
                                  {MATERIAL_PROVIDERS.map(p => {
                                      const selected = (editingItem.boardProvider || '').includes(p.name);
                                      return <button key={p.name} type="button" onClick={() => {
                                          let curr = (editingItem.boardProvider || '').split(', ').filter((s: string) => s);
                                          if (selected) curr = curr.filter((s: string) => s !== p.name); else curr.push(p.name);
                                          const newStr = curr.join(', ');
                                          const calc = runAutoSchedule(editingItem.materialOrderDate || '', newStr);
                                          setEditingItem(p => p ? {...p, boardProvider: newStr, pickingDate: calc.pickingDate} : null);
                                      }} className={`px-2 py-1.5 rounded-lg text-[9px] font-bold border transition-all ${selected ? 'bg-purple-600 text-white border-purple-600 shadow-md scale-105' : 'bg-white text-slate-500 border-purple-100 hover:border-purple-300'}`}>{p.name} ({p.days}d)</button>
                                  })}
                              </div>
                          </div>
                      </div>

                      {/* Cột 3: KẾT QUẢ */}
                      <div className="flex flex-col gap-3 justify-center">
                          <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4 flex items-center justify-between shadow-sm"><div><div className="text-[10px] font-black text-orange-600 uppercase">Soạn Hàng (Rule 5)</div><div className="text-[9px] text-orange-400 font-medium">(Ván về + 1)</div></div><div className="text-sm font-black text-orange-700">{editingItem.pickingDate ? toShortDate(editingItem.pickingDate) : '--'}</div></div>
                          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex items-center justify-between shadow-sm"><div><div className="text-[10px] font-black text-emerald-600 uppercase">Giao Hàng (Rule 6)</div><div className="text-[9px] text-emerald-500 font-medium">(Tự nhập)</div></div><input type="date" className="bg-transparent text-right text-sm font-black text-emerald-700 outline-none w-32 border-b border-transparent focus:border-emerald-300 transition-colors" value={editingItem.deliveryDate || ''} onChange={e => setEditingItem(p => p ? {...p, deliveryDate: e.target.value} : null)}/></div>
                          <div className="bg-slate-100 border border-slate-200 rounded-2xl p-4 flex items-center justify-between shadow-sm"><div><div className="text-[10px] font-black text-slate-600 uppercase">Nghiệm Thu (Rule 8)</div><div className="text-[9px] text-slate-400 font-medium">(Giao + Time)</div></div><div className="text-sm font-black text-slate-700">{editingItem.deliveryDate ? toShortDate(calculateDate(editingItem.deliveryDate, editingItem.duration)) : '--'}</div></div>
                      </div>
                  </div>

                  {/* D. THÔNG TIN KHÁC (Đơn hàng & Triển khai) */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm space-y-5">
                           <h4 className="text-xs font-bold text-slate-400 uppercase border-b border-slate-100 pb-2">Đơn hàng</h4>
                           <div><label className="text-[10px] font-bold text-slate-400 uppercase mb-1.5 block">Mã Đơn</label><input className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 font-bold text-slate-700 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-100 transition-all" value={editingItem.title || ''} onChange={e => setEditingItem(p => p ? {...p, title: e.target.value} : null)} /></div>
                           <div><label className="text-[10px] font-bold text-slate-400 uppercase mb-1.5 block">Khách Hàng</label><input className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 font-bold text-slate-700 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-100 transition-all" value={editingItem.client || ''} onChange={e => setEditingItem(p => p ? {...p, client: e.target.value} : null)} /></div>
                           <div><label className="text-[10px] font-bold text-slate-400 uppercase mb-1.5 block">Phân loại</label><input list="prod-types" className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 font-bold text-slate-700 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-100 transition-all" value={editingItem.productType || ''} onChange={e => setEditingItem(p => p ? {...p, productType: e.target.value} : null)} /><datalist id="prod-types">{PRODUCT_TYPES.map(t => <option key={t} value={t} />)}</datalist></div>
                           <div><label className="text-[10px] font-bold text-slate-400 uppercase mb-1.5 block">Trạng thái</label><select className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm font-bold text-indigo-600 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-100" value={editingItem.taskName || ''} onChange={e => setEditingItem(p => p ? {...p, taskName: e.target.value, status: e.target.value} : null)}>{WORKFLOW_STEPS.map(s => <option key={s} value={s}>{s}</option>)}</select></div>
                      </div>

                      <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm space-y-5">
                           <h4 className="text-xs font-bold text-slate-400 uppercase border-b border-slate-100 pb-2">Triển khai</h4>
                           <div className="grid grid-cols-2 gap-4">
                               <div><label className="text-[10px] font-bold text-slate-400 uppercase mb-1.5 block">Thợ Chính</label><select className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm font-bold outline-none focus:bg-white focus:ring-2 focus:ring-indigo-100" value={editingItem.worker || ''} onChange={e => setEditingItem(p => p ? {...p, worker: e.target.value} : null)}><option value="">-- Chọn --</option>{WORKER_LIST.map(w => <option key={w} value={w}>{w}</option>)}</select></div>
                               <div><label className="text-[10px] font-bold text-slate-400 uppercase mb-1.5 block">Trạng thái VT</label>
                                  <select className={`w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm font-bold outline-none text-center cursor-pointer ${editingItem.otherSupply?.includes('[Đang đặt]') ? 'text-yellow-600 bg-yellow-50' : editingItem.otherSupply?.includes('[Đã giao]') ? 'text-emerald-600 bg-emerald-50' : 'text-slate-500'}`} 
                                      value={editingItem.otherSupply?.includes('[Đang đặt]') ? 'ordering' : editingItem.otherSupply?.includes('[Đã giao]') ? 'delivered' : 'request'} 
                                      onChange={e => {
                                          let nm = (editingItem.otherSupply || '').replace(/\[.*?\]/g, '').trim();
                                          let sf = e.target.value === 'ordering' ? ' [Đang đặt]' : e.target.value === 'delivered' ? ' [Đã giao]' : '';
                                          setEditingItem(p => p ? {...p, otherSupply: nm + sf} : null);
                                      }}>
                                      <option value="request">🔴 Yêu cầu</option><option value="ordering">⏳ Đang đặt</option><option value="delivered">✅ Đã giao</option>
                                  </select>
                                </div>
                           </div>
                           
                           {/* Multi-select Vật tư phụ */}
                           <div><label className="text-[10px] font-bold text-slate-400 uppercase mb-1.5 block">Vật tư phụ (Chọn nhiều)</label>
                              <div className="flex flex-wrap gap-2 mb-2">
                                  {OTHER_SUPPLIES.map(s => {
                                      const selected = (editingItem.otherSupply || '').includes(s);
                                      return <button key={s} type="button" onClick={() => {
                                          let nm = (editingItem.otherSupply || '').replace(/\[.*?\]/g, '').trim();
                                          let sf = (editingItem.otherSupply || '').match(/\[.*?\]/)?.[0] || '';
                                          let parts = nm.split(', ').filter(x => x);
                                          if (selected) parts = parts.filter(x => x !== s); else parts.push(s);
                                          setEditingItem(p => p ? {...p, otherSupply: parts.join(', ') + sf} : null);
                                      }} className={`px-2 py-1 rounded text-[9px] font-bold border transition-all ${selected ? 'bg-indigo-600 text-white border-indigo-600 shadow-md scale-105' : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-white hover:border-indigo-300'}`}>{s}</button>
                                  })}
                              </div>
                              <input className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm font-bold outline-none focus:bg-white focus:ring-2 focus:ring-indigo-100" placeholder="Nhập thêm (hoặc chọn ở trên)..." value={(editingItem.otherSupply || '').replace(/\[.*?\]/g, '').trim()} onChange={e => {
                                  let sf = (editingItem.otherSupply || '').match(/\[.*?\]/)?.[0] || '';
                                  setEditingItem(p => p ? {...p, otherSupply: e.target.value + sf} : null);
                              }}/>
                           </div>
                           
                           <div><label className="text-[10px] font-bold text-slate-400 uppercase mb-1.5 block">Ghi chú</label><textarea className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm h-20 resize-none outline-none focus:bg-white focus:ring-2 focus:ring-indigo-100" placeholder="Nhập ghi chú..." value={editingItem.note || ''} onChange={e => setEditingItem(p => p ? {...p, note: e.target.value} : null)} /></div>
                      </div>
                  </div>
              </div>
           </div>

           {/* 3. FOOTER: Nút Lưu */}
           <div className="px-8 py-5 border-t border-slate-200 bg-white sticky bottom-0 z-40 flex justify-end gap-4 shrink-0 shadow-[0_-4px_20px_-10px_rgba(0,0,0,0.05)]">
              <button type="button" onClick={() => setIsModalOpen(false)} className="px-6 py-3 rounded-xl text-slate-600 font-bold bg-white border border-slate-200 hover:bg-slate-50 shadow-sm transition-all">Hủy bỏ</button>
              <button type="submit" className="px-8 py-3 rounded-xl bg-gradient-to-br from-indigo-600 to-indigo-700 text-white font-bold hover:shadow-lg hover:shadow-indigo-200 transition-all flex items-center gap-2">
                  {loading ? <Loader2 size={20} className="animate-spin"/> : <Save size={20}/>} Lưu Thay Đổi
              </button>
           </div>
        </form>
        )}
      </Modal>

      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </div>
  );
}