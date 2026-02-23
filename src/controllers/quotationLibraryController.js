// server/src/controllers/quotationLibraryController.js
const prisma = require("../utils/prisma");

// ===============================================
// 1. إدارة البنود (Items)
// ===============================================

// توليد كود البند (ITM-XXX)
const generateItemCode = async () => {
  const lastItem = await prisma.quotationLibraryItem.findFirst({
    where: { code: { startsWith: 'ITM-' } },
    orderBy: { code: 'desc' },
  });
  let nextSeq = 1;
  if (lastItem) {
    const lastSeq = parseInt(lastItem.code.split('-')[1], 10);
    nextSeq = lastSeq + 1;
  }
  return `ITM-${nextSeq.toString().padStart(3, '0')}`;
};

const getItems = async (req, res) => {
  try {
    const items = await prisma.quotationLibraryItem.findMany({ orderBy: { code: 'asc' } });
    res.json({ success: true, data: items });
  } catch (error) {
    res.status(500).json({ success: false, message: 'فشل جلب البنود' });
  }
};

const saveItem = async (req, res) => {
  try {
    const data = req.body;
    
    if (data.id === 'NEW' || !data.id) {
      const newCode = await generateItemCode();
      const newItem = await prisma.quotationLibraryItem.create({
        data: {
          code: newCode,
          title: data.title,
          description: data.desc,
          category: data.category,
          subCategory: data.subCategory,
          unit: data.unit,
          price: parseFloat(data.price),
          isEditable: data.editable,
          isActive: data.isActive,
          warningText: data.warning,
        }
      });
      return res.status(201).json({ success: true, data: newItem });
    }

    const updatedItem = await prisma.quotationLibraryItem.update({
      where: { code: data.id }, // نستخدم الـ code كمعرف في الواجهة
      data: {
        title: data.title,
        description: data.desc,
        category: data.category,
        subCategory: data.subCategory,
        unit: data.unit,
        price: parseFloat(data.price),
        isEditable: data.editable,
        isActive: data.isActive,
        warningText: data.warning,
      }
    });
    res.json({ success: true, data: updatedItem });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'فشل حفظ البند' });
  }
};

const toggleItemStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const item = await prisma.quotationLibraryItem.findUnique({ where: { code: id } });
    await prisma.quotationLibraryItem.update({
      where: { code: id },
      data: { isActive: !item.isActive }
    });
    res.json({ success: true, message: 'تم التحديث' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'فشل التحديث' });
  }
};

// ===============================================
// 2. إدارة المجموعات (Bundles)
// ===============================================

// توليد كود المجموعة (BDL-XXX)
const generateBundleCode = async () => {
  const lastBundle = await prisma.quotationBundle.findFirst({
    where: { code: { startsWith: 'BDL-' } },
    orderBy: { code: 'desc' },
  });
  let nextSeq = 1;
  if (lastBundle) {
    const lastSeq = parseInt(lastBundle.code.split('-')[1], 10);
    nextSeq = lastSeq + 1;
  }
  return `BDL-${nextSeq.toString().padStart(3, '0')}`;
};

const getBundles = async (req, res) => {
  try {
    const bundles = await prisma.quotationBundle.findMany({ orderBy: { code: 'asc' } });
    res.json({ success: true, data: bundles });
  } catch (error) {
    res.status(500).json({ success: false, message: 'فشل جلب المجموعات' });
  }
};

const saveBundle = async (req, res) => {
  try {
    const data = req.body;
    
    if (data.id === 'NEW' || !data.id) {
      const newCode = await generateBundleCode();
      const newBundle = await prisma.quotationBundle.create({
        data: {
          code: newCode,
          title: data.title,
          description: data.desc,
          icon: data.icon,
          color: data.color || 'blue',
          itemsIds: data.items, // Array of ITM codes
        }
      });
      return res.status(201).json({ success: true, data: newBundle });
    }

    const updatedBundle = await prisma.quotationBundle.update({
      where: { code: data.id },
      data: {
        title: data.title,
        description: data.desc,
        icon: data.icon,
        itemsIds: data.items,
      }
    });
    res.json({ success: true, data: updatedBundle });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'فشل حفظ المجموعة' });
  }
};

module.exports = {
  getItems, saveItem, toggleItemStatus,
  getBundles, saveBundle
};