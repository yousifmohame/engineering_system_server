// controllers/projectController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ===============================================
// 1. إنشاء مشروع جديد
// POST /api/projects
// ===============================================
const createProject = async (req, res) => {
  try {
    const { title, description, status } = req.body;
    
    // req.employee.id يأتي من الـ middleware "protect"
    // هذا يضمن أننا نعرف من هو الموظف الذي أنشأ المشروع
    const managerId = req.employee.id;

    if (!title) {
      return res.status(400).json({ message: 'عنوان المشروع مطلوب' });
    }

    const newProject = await prisma.project.create({
      data: {
        title,
        description,
        status,
        managerId, // ربط المشروع بالموظف (المدير)
      },
    });

    res.status(201).json(newProject);

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'خطأ في الخادم' });
  }
};

// ===============================================
// 2. جلب جميع المشاريع (الخاصة بالموظف)
// GET /api/projects
// ===============================================
const getAllProjects = async (req, res) => {
  try {
    // جلب المشاريع التي يديرها الموظف المسجل دخوله فقط
    const projects = await prisma.project.findMany({
      where: {
        managerId: req.employee.id,
      },
      orderBy: {
        createdAt: 'desc', // عرض الأحدث أولاً
      },
    });

    res.status(200).json(projects);

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'خطأ في الخادم' });
  }
};

// ===============================================
// 3. جلب مشروع واحد
// GET /api/projects/:id
// ===============================================
const getProjectById = async (req, res) => {
  try {
    const { id } = req.params;
    const project = await prisma.project.findUnique({
      where: { id: parseInt(id) }, // تحويل الـ ID إلى رقم
    });

    if (!project) {
      return res.status(404).json({ message: 'المشروع غير موجود' });
    }

    // التحقق من أن الموظف هو مدير هذا المشروع
    if (project.managerId !== req.employee.id) {
        return res.status(403).json({ message: 'غير مصرح لك برؤية هذا المشروع' });
    }

    res.status(200).json(project);

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'خطأ في الخادم' });
  }
};

// ===============================================
// 4. تحديث مشروع
// PUT /api/projects/:id
// ===============================================
const updateProject = async (req, res) => {
    try {
        const { id } = req.params;
        const { title, description, status } = req.body;

        // أولاً، تحقق من وجود المشروع
        const project = await prisma.project.findUnique({
            where: { id: parseInt(id) },
        });

        if (!project) {
            return res.status(404).json({ message: 'المشروع غير موجود' });
        }

        // التحقق من أن الموظف هو مدير هذا المشروع
        if (project.managerId !== req.employee.id) {
            return res.status(403).json({ message: 'غير مصرح لك بتعديل هذا المشروع' });
        }

        // تحديث المشروع
        const updatedProject = await prisma.project.update({
            where: { id: parseInt(id) },
            data: {
                title,
                description,
                status,
            },
        });

        res.status(200).json(updatedProject);

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
};

// ===============================================
// 5. حذف مشروع
// DELETE /api/projects/:id
// ===============================================
const deleteProject = async (req, res) => {
    try {
        const { id } = req.params;

        // أولاً، تحقق من وجود المشروع
        const project = await prisma.project.findUnique({
            where: { id: parseInt(id) },
        });

        if (!project) {
            return res.status(404).json({ message: 'المشروع غير موجود' });
        }

        // التحقق من أن الموظف هو مدير هذا المشروع
        if (project.managerId !== req.employee.id) {
            return res.status(403).json({ message: 'غير مصرح لك بحذف هذا المشروع' });
        }

        // حذف المشروع
        await prisma.project.delete({
            where: { id: parseInt(id) },
        });

        res.status(200).json({ message: 'تم حذف المشروع بنجاح' });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
};


// تصدير جميع الوظائف
module.exports = {
  createProject,
  getAllProjects,
  getProjectById,
  updateProject,
  deleteProject,
};