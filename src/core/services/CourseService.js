// services/CourseService.js

import { Course } from "../../models/Course.js";

export class CourseService {
  constructor(tauriService) {
    this.tauriService = tauriService;
    this.courses = {};
  }

  async loadCourses() {
    try {
      const data = await this.tauriService.invoke("parcours");

      const rawData = data?.course || data || {};

      this.courses = {};
      for (const [mapKey, courseData] of Object.entries(rawData)) {
        this.courses[mapKey] = new Course(mapKey, courseData);
      }

      return this.courses;
    } catch (error) {
      console.error("❌ Erreur chargement parcours:", error);
      throw error;
    }
  }

  getCourse(mapKey) {
    return this.courses[mapKey] || null;
  }

  getCourses() {
    return Object.values(this.courses);
  }

  getCourseKeys() {
    return Object.keys(this.courses);
  }

  getCourseOptions() {
    return this.getCourseKeys().map((key) => ({
      value: key,
      label: this.courses[key].name,
    }));
  }

  getHoleOptions(mapKey) {
    const course = this.getCourse(mapKey);
    if (!course) return [];
    return course.getHoleKeys().map((key) => ({
      value: key,
      label: ` ${key}`,
    }));
  }

  getHoleOptions(mapKey) {
    const course = this.getCourse(mapKey);
    if (!course) return [];
    const holes = course.holes || course.trous || {};

    // === TRI NUMÉRIQUE ===
    const sortedKeys = Object.keys(holes).sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, "")) || 0;
      const numB = parseInt(b.replace(/\D/g, "")) || 0;
      return numA - numB;
    });

    return sortedKeys.map((key) => {
      const holeData = holes[key];
      const par = holeData?.par || "";
      return {
        value: key,
        label: par ? `${key} (Par ${par})` : `${key}`,
      };
    });
  }
}
